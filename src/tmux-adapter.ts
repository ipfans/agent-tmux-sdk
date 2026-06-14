import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TmuxError } from "./errors.js";
import type {
  ClaudeExecutionRequest,
  ClaudeExecutionResult,
  ClaudeSessionId,
  ClaudeStartOptions,
  RealTmuxAdapterOptions,
  TmuxAdapter,
  TmuxProcessHandle,
} from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_STABLE_THRESHOLD_MS = 5000;
// Claude's spinner shows "✻ <Gerund> for <N>s" when a turn completes
// (e.g. "✻ Crunched for 5s"); the gerund varies per turn, so match generically.
const DEFAULT_READY_PATTERN = /✻\s+\S+\s+for\s+[\d.]+\s*s/;
const SESSION_ID_PATTERN = /Resume this session with:\s*claude\s+--resume\s+(\S+)/;
const SESSION_ID_FORMAT = /^[a-zA-Z0-9_-]+$/;
// Claude's running UI chrome. Used to detect readiness and exit instead of the
// prompt char ❯, which collides with common shell prompts (zsh/starship/p10k).
const CLAUDE_RUNNING_PATTERN = /⏵⏵|context\)|for shortcuts|esc to interrupt/;
// Claude writes session state as it exits; relaunching too soon makes the new
// process exit immediately. Settle after exit before any subsequent start.
const CLAUDE_EXIT_SETTLE_MS = 3000;

/* v8 ignore start */
export class RealTmuxAdapter implements TmuxAdapter {
  private readonly pollIntervalMs: number;
  private readonly stableThresholdMs: number;
  private readonly readyPattern: RegExp;

  constructor(options: RealTmuxAdapterOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stableThresholdMs = options.stableThresholdMs ?? DEFAULT_STABLE_THRESHOLD_MS;
    this.readyPattern = options.readyPattern ?? DEFAULT_READY_PATTERN;
  }

  async createSession(sessionName: string, workingDirectory?: string): Promise<TmuxProcessHandle> {
    // Wide pane: a detached session defaults to 80 cols, which wraps large
    // compact JSON mid-token and can corrupt it on capture. A wide pane keeps
    // long lines intact so extraction stays reliable.
    const args = ["new-session", "-d", "-s", sessionName, "-x", "400", "-y", "50"];
    if (workingDirectory !== undefined) {
      args.push("-c", workingDirectory);
    }
    await execFileAsync("tmux", args);
    return {
      sessionName,
      paneId: `${sessionName}:0.0`,
      startedAt: Date.now(),
    };
  }

  async killSession(sessionName: string): Promise<void> {
    await execFileAsync("tmux", ["kill-session", "-t", sessionName]);
  }

  async startClaude(sessionName: string, options: ClaudeStartOptions): Promise<void> {
    const cmd = this.buildClaudeCommand(options);
    await execFileAsync("tmux", ["send-keys", "-t", sessionName, cmd, "Enter"]);
    const timeoutMs = options.startupTimeoutMs ?? 30_000;
    const started = await this.waitForStartup(sessionName, timeoutMs);
    if (!started) {
      throw new TmuxError(`Claude failed to start within ${timeoutMs}ms in ${sessionName}`);
    }
  }

  async exitClaude(sessionName: string): Promise<ClaudeSessionId | undefined> {
    await execFileAsync("tmux", ["send-keys", "-t", sessionName, "/exit", "Enter"]);
    const output = await this.waitForShellPrompt(sessionName);
    const match = SESSION_ID_PATTERN.exec(output);
    // Let Claude finish releasing session state so a subsequent start doesn't
    // race it and exit immediately.
    await new Promise((resolve) => setTimeout(resolve, CLAUDE_EXIT_SETTLE_MS));
    return match?.[1];
  }

  async resumeClaude(sessionName: string, sessionId: ClaudeSessionId): Promise<void> {
    await this.startClaude(sessionName, { sessionId });
  }

  async execute(sessionName: string, request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult> {
    if (request.workingDirectory) {
      await this.sendPrompt(sessionName, `/cd ${request.workingDirectory}`);
    }

    await this.sendPrompt(sessionName, request.prompt);

    if (request.waitForResult === false) {
      const output = await this.capturePane(sessionName);
      return { exitCode: 0, output };
    }

    // Claude's TUI scrolls the prompt echo and response out of the visible pane,
    // so completion detection and capture run against joined scrollback. Return
    // only the slice after the current prompt echo so the output is clean and a
    // reused slot's earlier turns can't leak into extraction.
    const full = await this.waitForCompletion(sessionName);
    return { exitCode: 0, output: this.sliceFromLastPrompt(full, request.prompt) };
  }

  async *stream(sessionName: string, request: ClaudeExecutionRequest): AsyncIterable<string> {
    if (request.workingDirectory) {
      await this.sendPrompt(sessionName, `/cd ${request.workingDirectory}`);
    }

    await this.sendPrompt(sessionName, request.prompt);

    let lastOutput = "";
    let stableSince = 0;
    let seenPrompt = false;
    const deadline = Date.now() + 10 * 60 * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const output = await this.capturePane(sessionName);

      if (!seenPrompt) {
        if (output.includes(request.prompt)) {
          seenPrompt = true;
          lastOutput = output;
        }
        continue;
      }

      if (output !== lastOutput) {
        const delta = this.extractDelta(lastOutput, output);
        if (delta.length > 0) {
          yield delta;
        }
        lastOutput = output;
        stableSince = 0;
      } else {
        stableSince += this.pollIntervalMs;
      }

      if (this.isResponseComplete(output, request.prompt) || stableSince >= this.stableThresholdMs) {
        return;
      }
    }
  }

  async capturePane(sessionName: string): Promise<string> {
    const { stdout } = await execFileAsync("tmux", ["capture-pane", "-p", "-t", sessionName]);
    return stdout;
  }

  private async sendPrompt(sessionName: string, text: string): Promise<void> {
    // Send the text (-l = literal, so no token is mistaken for a key name) and
    // the submit Enter as SEPARATE keystrokes. A long prompt sent with a
    // trailing Enter in one send-keys call is not submitted — the Enter is
    // absorbed into the large input — so a distinct Enter after a beat is needed.
    await execFileAsync("tmux", ["send-keys", "-t", sessionName, "-l", text]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await execFileAsync("tmux", ["send-keys", "-t", sessionName, "Enter"]);
  }

  private async captureScrollback(sessionName: string): Promise<string> {
    // -J joins wrapped lines (so a wrapped prompt echo stays matchable); -S -
    // includes scrollback (so the prompt echo and a multi-screen answer are
    // captured even after Claude's TUI scrolls them out of the visible pane).
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane", "-p", "-J", "-S", "-", "-t", sessionName,
    ]);
    return stdout;
  }

  private sliceFromLastPrompt(capture: string, prompt: string): string {
    const idx = capture.lastIndexOf(prompt);
    return idx >= 0 ? capture.slice(idx + prompt.length) : capture;
  }

  private buildClaudeCommand(options: ClaudeStartOptions): string {
    const parts = ["claude"];
    if (options.sessionId) {
      if (!SESSION_ID_FORMAT.test(options.sessionId)) {
        throw new TmuxError(`Invalid Claude session ID format: ${options.sessionId}`);
      }
      parts.push("--resume", options.sessionId);
    }
    if (options.dangerouslySkipPermissions === true) {
      parts.push("--dangerously-skip-permissions");
    }
    return parts.join(" ");
  }

  private async waitForStartup(sessionName: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const output = await this.capturePane(sessionName);
      // Claude's prompt char (❯) often matches the shell prompt, so detect
      // readiness by Claude's UI chrome instead.
      if (CLAUDE_RUNNING_PATTERN.test(output)) {
        return true;
      }
    }
    return false;
  }

  private async waitForShellPrompt(sessionName: string): Promise<string> {
    const deadline = Date.now() + 30_000;
    let lastOutput = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      lastOutput = await this.capturePane(sessionName);
      // Claude has returned to the shell once its UI chrome is gone.
      if (!CLAUDE_RUNNING_PATTERN.test(lastOutput)) {
        return lastOutput;
      }
    }
    return lastOutput;
  }

  private async waitForCompletion(
    sessionName: string,
    capture: (session: string) => Promise<string> = (session) => this.captureScrollback(session),
  ): Promise<string> {
    // The prompt echo reflows unpredictably across indented lines in Claude's
    // input box, so completion is detected structurally rather than by matching
    // the prompt text: wait for the pane to change (Claude started responding),
    // then for it to stop changing (response finished). Claude's animated
    // spinner keeps the pane changing while it works, so stability only settles
    // once the turn is genuinely done.
    const baseline = await capture(sessionName);
    let lastOutput = baseline;
    let stableSince = 0;
    let changed = false;
    const deadline = Date.now() + 10 * 60 * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const output = await capture(sessionName);

      if (!changed) {
        if (output !== baseline) {
          changed = true;
          lastOutput = output;
        }
        continue;
      }

      if (output === lastOutput) {
        stableSince += this.pollIntervalMs;
        if (stableSince >= this.stableThresholdMs) {
          return output;
        }
      } else {
        lastOutput = output;
        stableSince = 0;
      }
    }

    return lastOutput;
  }

  private extractDelta(previous: string, current: string): string {
    if (current.startsWith(previous)) {
      return current.slice(previous.length);
    }
    const prevLines = previous.split("\n");
    const currLines = current.split("\n");
    let commonPrefix = 0;
    while (commonPrefix < prevLines.length && commonPrefix < currLines.length && prevLines[commonPrefix] === currLines[commonPrefix]) {
      commonPrefix++;
    }
    return currLines.slice(commonPrefix).join("\n");
  }

  private isResponseComplete(output: string, prompt: string): boolean {
    const promptIdx = output.lastIndexOf(prompt);
    if (promptIdx < 0) return false;

    const afterPrompt = output.slice(promptIdx + prompt.length);
    return this.readyPattern.test(afterPrompt);
  }
}
/* v8 ignore stop */

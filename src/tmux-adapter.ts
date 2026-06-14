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
const DEFAULT_READY_PATTERN = /✻ (Baked|Took|Done|Cogitated)/;
const SESSION_ID_PATTERN = /Resume this session with:\s*claude\s+--resume\s+(\S+)/;
const SESSION_ID_FORMAT = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_SHELL_PROMPT_PATTERN = /[$%#>]\s*$/m;

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
    const args = ["new-session", "-d", "-s", sessionName];
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
    return match?.[1];
  }

  async resumeClaude(sessionName: string, sessionId: ClaudeSessionId): Promise<void> {
    await this.startClaude(sessionName, { sessionId });
  }

  async execute(sessionName: string, request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult> {
    if (request.workingDirectory) {
      await execFileAsync("tmux", [
        "send-keys", "-t", sessionName,
        `/cd ${request.workingDirectory}`, "Enter",
      ]);
    }

    await execFileAsync("tmux", ["send-keys", "-t", sessionName, request.prompt, "Enter"]);

    if (request.waitForResult === false) {
      const output = await this.capturePane(sessionName);
      return { exitCode: 0, output };
    }

    // Result mode needs the full answer even when it scrolls past the visible
    // pane, and must not pick up a prior task's JSON from a reused slot. Detect
    // completion and capture against joined scrollback, then return only the
    // slice after the current prompt echo so extraction sees just this answer.
    if (request.mode === "result") {
      const full = await this.waitForCompletion(sessionName, request.prompt, (s) => this.captureResult(s));
      return { exitCode: 0, output: this.sliceFromLastPrompt(full, request.prompt) };
    }

    const output = await this.waitForCompletion(sessionName, request.prompt);
    return { exitCode: 0, output };
  }

  async *stream(sessionName: string, request: ClaudeExecutionRequest): AsyncIterable<string> {
    if (request.workingDirectory) {
      await execFileAsync("tmux", [
        "send-keys", "-t", sessionName,
        `/cd ${request.workingDirectory}`, "Enter",
      ]);
    }

    await execFileAsync("tmux", ["send-keys", "-t", sessionName, request.prompt, "Enter"]);

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

  private async captureResult(sessionName: string): Promise<string> {
    // -J joins wrapped lines (so a wrapped prompt echo stays matchable); -S -
    // includes scrollback (so a multi-screen answer is captured in full).
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
    const startupPattern = /❯\s*$/m;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const output = await this.capturePane(sessionName);
      if (startupPattern.test(output)) {
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
      if (DEFAULT_SHELL_PROMPT_PATTERN.test(lastOutput)) {
        return lastOutput;
      }
    }
    return lastOutput;
  }

  private async waitForCompletion(
    sessionName: string,
    prompt: string,
    capture: (session: string) => Promise<string> = (session) => this.capturePane(session),
  ): Promise<string> {
    let lastOutput = "";
    let stableSince = 0;
    let seenPrompt = false;
    const deadline = Date.now() + 10 * 60 * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const output = await capture(sessionName);

      if (!seenPrompt) {
        if (output.includes(prompt)) {
          seenPrompt = true;
        }
        lastOutput = output;
        continue;
      }

      if (this.isResponseComplete(output, prompt)) {
        return output;
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

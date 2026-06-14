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
const DEFAULT_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000;
// Claude's spinner shows "✻ <Gerund> for <N>s" when a turn completes
// (e.g. "✻ Crunched for 5s"); the gerund varies per turn, so match generically.
const DEFAULT_READY_PATTERN = /✻\s+\S+\s+for\s+[\d.]+\s*s/;
const SESSION_ID_PATTERN = /Resume this session with:\s*claude\s+--resume\s+(\S+)/;
const SESSION_ID_FORMAT = /^[a-zA-Z0-9_-]+$/;
// Model alias (e.g. "haiku"), full name (e.g. "claude-haiku-4-5-20251001"), or a
// name with a bracketed suffix (e.g. "claude-opus-4-8[1m]"). Allows letters,
// digits, and . _ - [ ] only — no whitespace or shell/key-special characters —
// since the result is typed into the launch command.
const MODEL_FORMAT = /^[a-zA-Z0-9][a-zA-Z0-9._[\]-]*$/;
// Claude's running UI chrome. Used to detect readiness and exit instead of the
// prompt char ❯, which collides with common shell prompts (zsh/starship/p10k).
const CLAUDE_RUNNING_PATTERN = /⏵⏵|context\)|for shortcuts|esc to interrupt/;
// Claude writes session state as it exits; relaunching too soon makes the new
// process exit immediately. Settle after exit before any subsequent start.
const CLAUDE_EXIT_SETTLE_MS = 3000;
// Gap between sending a (literal) prompt and the submit Enter, so a long prompt
// finishes rendering before the Enter (a combined send-keys drops the Enter).
const CLAUDE_SEND_SETTLE_MS = 300;

/* v8 ignore start */
export class RealTmuxAdapter implements TmuxAdapter {
  private readonly pollIntervalMs: number;
  private readonly stableThresholdMs: number;
  private readonly readyPattern: RegExp;
  private readonly completionTimeoutMs: number;

  constructor(options: RealTmuxAdapterOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stableThresholdMs = options.stableThresholdMs ?? DEFAULT_STABLE_THRESHOLD_MS;
    this.readyPattern = options.readyPattern ?? DEFAULT_READY_PATTERN;
    this.completionTimeoutMs = options.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;
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
    // Let Claude finish releasing session state so a subsequent start doesn't
    // race it and exit immediately.
    await new Promise((resolve) => setTimeout(resolve, CLAUDE_EXIT_SETTLE_MS));
    // Re-capture after the settle: the "Resume this session with: claude --resume
    // <id>" line can render just as the UI chrome clears — i.e. right after
    // waitForShellPrompt returns — so the pre-settle capture may not contain it
    // yet. Prefer the settled capture and fall back to the earlier one.
    const settled = await this.capturePane(sessionName);
    const match = SESSION_ID_PATTERN.exec(settled) ?? SESSION_ID_PATTERN.exec(output);
    return match?.[1];
  }

  async resumeClaude(sessionName: string, sessionId: ClaudeSessionId): Promise<void> {
    await this.startClaude(sessionName, { sessionId });
  }

  async interrupt(sessionName: string): Promise<void> {
    // Escape stops Claude's current turn and returns it to an idle prompt (a
    // no-op when Claude is already idle). Used to recover a slot whose stream was
    // abandoned mid-response so the next task isn't typed into a busy turn.
    await execFileAsync("tmux", ["send-keys", "-t", sessionName, "Escape"]);
  }

  async execute(sessionName: string, request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult> {
    // Clear prior scrollback so the completion capture is scoped to this task's
    // turn — a pooled slot otherwise accumulates earlier tasks' output, which
    // could leak a stale JSON value into extraction.
    await execFileAsync("tmux", ["clear-history", "-t", sessionName]);

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
    // Scope the capture to this turn (a pooled slot otherwise carries earlier
    // output), matching execute().
    await execFileAsync("tmux", ["clear-history", "-t", sessionName]);

    if (request.workingDirectory) {
      await this.sendPrompt(sessionName, `/cd ${request.workingDirectory}`);
    }

    await this.sendPrompt(sessionName, request.prompt);

    // Detect start/finish structurally — wait for the pane to change, then to
    // stop changing — rather than matching the prompt text, which reflows
    // unpredictably in the input box. Anything already captured (the prompt echo
    // and Claude's chrome) is the baseline; only transcript text beyond it is
    // streamed.
    let emitted = this.responseRegion(await this.captureScrollback(sessionName));
    let lastFull = "";
    let stableSince = 0;
    let changed = false;
    const deadline = Date.now() + this.completionTimeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const full = await this.captureScrollback(sessionName);
      const region = this.responseRegion(full);

      const delta = this.appendDelta(emitted, region);
      if (delta.length > 0) {
        emitted += delta;
        yield delta;
      }

      if (full !== lastFull) {
        changed = true;
        stableSince = 0;
      } else {
        stableSince += this.pollIntervalMs;
      }
      lastFull = full;

      if (changed && stableSince >= this.stableThresholdMs) {
        return;
      }
    }

    // Deadline hit — throw a typed error rather than returning silently as if the
    // stream finished, which would mask a stuck or truncated turn.
    throw new TmuxError(
      `Claude stream did not complete within ${this.completionTimeoutMs}ms in ${sessionName}`,
    );
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
    // "--" ends option parsing so a prompt starting with "-" is treated as text
    // rather than a tmux flag (which would otherwise fail the command).
    await execFileAsync("tmux", ["send-keys", "-t", sessionName, "-l", "--", text]);
    await new Promise((resolve) => setTimeout(resolve, CLAUDE_SEND_SETTLE_MS));
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
    if (options.model) {
      if (!MODEL_FORMAT.test(options.model)) {
        throw new TmuxError(`Invalid Claude model format: ${options.model}`);
      }
      parts.push("--model", options.model);
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
    // Claude never exited — fail rather than letting the caller relaunch and
    // type a shell command into the still-running session.
    throw new TmuxError(`Claude did not exit within 30000ms in ${sessionName}`);
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
    const deadline = Date.now() + this.completionTimeoutMs;

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

    // Deadline hit without the pane stabilizing — surface a typed error instead
    // of returning a partial capture as if it were a complete response (which
    // would silently feed truncated output into extraction and trigger retries).
    throw new TmuxError(
      `Claude response did not complete within ${this.completionTimeoutMs}ms in ${sessionName}`,
    );
  }

  /**
   * Strip Claude's trailing UI chrome — blank lines, the animated spinner, and
   * the bordered input box with its hints — from the bottom of a capture so the
   * remaining transcript grows append-only and can be diffed for stream deltas.
   * Best-effort: it walks up from the bottom while lines look like chrome.
   */
  private responseRegion(capture: string): string {
    const lines = capture.split("\n");
    let end = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      const isChrome =
        trimmed === "" ||
        CLAUDE_RUNNING_PATTERN.test(line) ||
        this.readyPattern.test(line) ||
        /^[╭╮╰╯│─\s]+$/u.test(trimmed) ||
        trimmed.startsWith("❯");
      if (isChrome) {
        end = i;
      } else {
        break;
      }
    }
    return lines.slice(0, end).join("\n");
  }

  /**
   * Return the part of `current` not already at the tail of `previous`, never
   * re-emitting text. Handles a plain append and the case where the capture
   * reflowed/scrolled by realigning on the longest overlap — so a scrolled pane
   * is not yielded wholesale (the previous line-prefix delta did exactly that).
   */
  private appendDelta(previous: string, current: string): string {
    if (current.length === 0) return "";
    if (previous.length === 0) return current;
    if (current.startsWith(previous)) return current.slice(previous.length);
    const max = Math.min(previous.length, current.length);
    for (let k = max; k > 0; k--) {
      if (previous.endsWith(current.slice(0, k))) {
        return current.slice(k);
      }
    }
    return current;
  }
}
/* v8 ignore stop */

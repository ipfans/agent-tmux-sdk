import type {
  ClaudeExecutionRequest,
  ClaudeExecutionResult,
  ClaudeSessionId,
  ClaudeStartOptions,
  TmuxAdapter,
  TmuxProcessHandle,
} from "../../src/index.js";
import { FakeClaude } from "./fake-claude.js";

interface FakeClaudeProcess {
  running: boolean;
  sessionId?: ClaudeSessionId;
}

export class FakeTmux implements TmuxAdapter {
  readonly claude = new FakeClaude();
  readonly sessionCreates: string[] = [];
  readonly sessionKills: string[] = [];
  readonly claudeStarts: Array<{ sessionName: string; options: ClaudeStartOptions }> = [];
  readonly claudeExits: string[] = [];
  readonly claudeResumes: Array<{ sessionName: string; sessionId: string }> = [];
  readonly executions: ClaudeExecutionRequest[] = [];
  readonly accountSwitches: Array<{ sessionName: string; account: string }> = [];
  readonly sessions = new Set<string>();
  readonly claudeProcesses = new Map<string, FakeClaudeProcess>();
  private nextSessionId = 1;

  failCreateSession = false;
  failKillSession = false;
  failStartClaude = false;
  failExitClaude = false;
  failResumeClaude = false;
  failAccountSwitch = false;

  async createSession(sessionName: string): Promise<TmuxProcessHandle> {
    if (this.failCreateSession) {
      throw new Error("tmux create session failed");
    }
    this.sessionCreates.push(sessionName);
    this.sessions.add(sessionName);
    return {
      sessionName,
      paneId: `${sessionName}:0.0`,
      startedAt: Date.now(),
    };
  }

  async killSession(sessionName: string): Promise<void> {
    if (this.failKillSession) {
      throw new Error("tmux kill session failed");
    }
    this.sessionKills.push(sessionName);
    this.sessions.delete(sessionName);
    this.claudeProcesses.delete(sessionName);
  }

  async startClaude(sessionName: string, options: ClaudeStartOptions): Promise<void> {
    if (this.failStartClaude) {
      throw new Error("claude start failed");
    }
    this.claudeStarts.push({ sessionName, options });
    this.claudeProcesses.set(sessionName, { running: true, sessionId: options.sessionId });
  }

  async exitClaude(sessionName: string): Promise<ClaudeSessionId | undefined> {
    if (this.failExitClaude) {
      throw new Error("claude exit failed");
    }
    this.claudeExits.push(sessionName);
    const process = this.claudeProcesses.get(sessionName);
    const sessionId = `session-${this.nextSessionId++}`;
    if (process) {
      process.running = false;
      process.sessionId = sessionId;
    }
    return sessionId;
  }

  async resumeClaude(sessionName: string, sessionId: ClaudeSessionId): Promise<void> {
    if (this.failResumeClaude) {
      throw new Error("claude resume failed");
    }
    this.claudeResumes.push({ sessionName, sessionId });
    this.claudeProcesses.set(sessionName, { running: true, sessionId });
  }

  async execute(
    _sessionName: string,
    request: ClaudeExecutionRequest,
  ): Promise<ClaudeExecutionResult> {
    this.executions.push(request);
    return this.claude.execute(request);
  }

  async switchAccount(sessionName: string, account: string): Promise<void> {
    if (this.failAccountSwitch) {
      throw new Error("account switch failed");
    }
    this.accountSwitches.push({ sessionName, account });
  }

  async capturePane(sessionName: string): Promise<string> {
    return this.sessions.has(sessionName) ? "pane content" : "";
  }
}

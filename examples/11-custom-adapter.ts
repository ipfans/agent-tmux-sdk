/**
 * Custom TmuxAdapter — plug in your own tmux/process implementation for
 * testing, logging, or alternative runtimes.
 *
 * 自定义 TmuxAdapter — 插入自己的 tmux/进程实现，用于测试、日志或替代运行时。
 */
import {
  AgentTmuxSdk,
  type TmuxAdapter,
  type TmuxProcessHandle,
  type ClaudeStartOptions,
  type ClaudeExecutionRequest,
  type ClaudeExecutionResult,
  type ClaudeSessionId,
} from "agent-tmux-sdk";

class LoggingTmuxAdapter implements TmuxAdapter {
  constructor(private readonly inner: TmuxAdapter) {}

  async createSession(sessionName: string, workingDirectory?: string): Promise<TmuxProcessHandle> {
    console.log(`[tmux] createSession: ${sessionName}`);
    return this.inner.createSession(sessionName, workingDirectory);
  }

  async killSession(sessionName: string): Promise<void> {
    console.log(`[tmux] killSession: ${sessionName}`);
    return this.inner.killSession(sessionName);
  }

  async capturePane(sessionName: string): Promise<string> {
    return this.inner.capturePane(sessionName);
  }

  async startClaude(sessionName: string, options: ClaudeStartOptions): Promise<void> {
    console.log(`[tmux] startClaude: ${sessionName}`);
    return this.inner.startClaude(sessionName, options);
  }

  async exitClaude(sessionName: string): Promise<ClaudeSessionId | undefined> {
    console.log(`[tmux] exitClaude: ${sessionName}`);
    return this.inner.exitClaude(sessionName);
  }

  async resumeClaude(sessionName: string, sessionId: ClaudeSessionId): Promise<void> {
    console.log(`[tmux] resumeClaude: ${sessionName}, sessionId=${sessionId}`);
    return this.inner.resumeClaude(sessionName, sessionId);
  }

  async execute(sessionName: string, request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult> {
    console.log(`[tmux] execute: session=${sessionName}, task=${request.taskId}`);
    const result = await this.inner.execute(sessionName, request);
    console.log(`[tmux] execute done: exitCode=${result.exitCode}`);
    return result;
  }

  async *stream(sessionName: string, request: ClaudeExecutionRequest): AsyncIterable<string> {
    console.log(`[tmux] stream: session=${sessionName}, task=${request.taskId}`);
    yield* this.inner.stream(sessionName, request);
  }

  async interrupt(sessionName: string): Promise<void> {
    console.log(`[tmux] interrupt: ${sessionName}`);
    return this.inner.interrupt(sessionName);
  }
}

async function main() {
  const { RealTmuxAdapter } = await import("agent-tmux-sdk");
  const adapter = new LoggingTmuxAdapter(new RealTmuxAdapter());

  const sdk = new AgentTmuxSdk({ tmux: adapter });
  const result = await sdk.runOneShot("Hello from custom adapter");
  console.log("Output:", result.output);

  await sdk.cleanup();
}

main().catch(console.error);

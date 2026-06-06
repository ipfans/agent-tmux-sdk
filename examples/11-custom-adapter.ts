/**
 * Custom TmuxAdapter — plug in your own tmux/process implementation for
 * testing, logging, or alternative runtimes.
 *
 * 自定义 TmuxAdapter — 插入自己的 tmux/进程实现，用于测试、日志或替代运行时。
 */
import {
  AgentTmuxSdk,
  type TmuxAdapter,
  type ProcessStartOptions,
  type TmuxProcessHandle,
  type ClaudeExecutionRequest,
  type ClaudeExecutionResult,
} from "agent-tmux-sdk";

// A logging adapter that wraps the real one and prints every operation.
// 一个包装真实适配器并打印每个操作的日志适配器。
class LoggingTmuxAdapter implements TmuxAdapter {
  constructor(private readonly inner: TmuxAdapter) {}

  async startProcess(options: ProcessStartOptions): Promise<TmuxProcessHandle> {
    console.log(`[tmux] startProcess: ${options.sessionName}`);
    return this.inner.startProcess(options);
  }

  async execute(sessionName: string, request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult> {
    console.log(`[tmux] execute: session=${sessionName}, task=${request.taskId}, resume=${request.resume}`);
    const result = await this.inner.execute(sessionName, request);
    console.log(`[tmux] execute done: exitCode=${result.exitCode}, tokenExhausted=${result.tokenExhausted}`);
    return result;
  }

  async restartProcess(sessionName: string, options: ProcessStartOptions): Promise<TmuxProcessHandle> {
    console.log(`[tmux] restartProcess: ${sessionName}`);
    return this.inner.restartProcess(sessionName, options);
  }

  async switchAccount(sessionName: string, account: string): Promise<void> {
    console.log(`[tmux] switchAccount: session=${sessionName}, account=${account}`);
    return this.inner.switchAccount(sessionName, account);
  }

  async capturePane(sessionName: string): Promise<string> {
    return this.inner.capturePane(sessionName);
  }

  async stopProcess(sessionName: string): Promise<void> {
    console.log(`[tmux] stopProcess: ${sessionName}`);
    return this.inner.stopProcess(sessionName);
  }
}

async function main() {
  // In production, wrap the real adapter; in tests, wrap a fake.
  // 生产环境中包装真实适配器；测试中包装假适配器。
  const { RealTmuxAdapter } = await import("agent-tmux-sdk");
  const adapter = new LoggingTmuxAdapter(new RealTmuxAdapter());

  const sdk = new AgentTmuxSdk({ tmux: adapter });
  const result = await sdk.runOneShot("Hello from custom adapter");
  console.log("Output:", result.output);

  await sdk.cleanup();
}

main().catch(console.error);

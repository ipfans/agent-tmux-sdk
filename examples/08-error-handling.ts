/**
 * Error handling — typed error hierarchy for precise error handling.
 *
 * 错误处理 — 类型化错误层次结构，用于精确的错误处理。
 */
import {
  AgentTmuxSdk,
  AgentTmuxSdkError,
  AgentTaskError,
  TmuxError,
  TaskTimeoutError,
  ResultParseError,
} from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk({
    taskTimeoutMs: 60_000,
    resumeAttempts: 2,
  });

  try {
    await sdk.runTask<{ count: number }>({
      taskId: "review",
      prompt: "Count bugs and return JSON",
      mode: "result",
    });
  } catch (error) {
    // Handle errors from most specific to least specific.
    // 从最具体到最通用处理错误。

    if (error instanceof TaskTimeoutError) {
      // Task exceeded its timeout / 任务超时
      console.error("Task timed out:", error.message);
    } else if (error instanceof ResultParseError) {
      // Result mode output was not valid JSON / 结果模式输出不是合法 JSON
      console.error("Invalid JSON output:", error.message);
    } else if (error instanceof AgentTaskError) {
      // General task failure (execution error, token exhaustion, etc.)
      // 通用任务失败（执行错误、Token 耗尽等）
      console.error("Task failed:", error.message);
    } else if (error instanceof TmuxError) {
      // Tmux session failure (start, restart, stop, account switch)
      // tmux 会话失败（启动、重启、停止、账户切换）
      console.error("Tmux error:", error.message);
      if (error.cause) {
        console.error("  Caused by:", error.cause);
      }
    } else if (error instanceof AgentTmuxSdkError) {
      // Catch-all for any SDK error / 捕获所有 SDK 错误
      console.error("SDK error:", error.message);
    }

    // Check task snapshot for details / 查看任务快照获取详情
    const snapshot = sdk.getTask("review");
    if (snapshot) {
      console.log("Task state:", snapshot.state);
      console.log("Task error:", snapshot.error);
    }
  } finally {
    await sdk.cleanup();
  }
}

main().catch(console.error);

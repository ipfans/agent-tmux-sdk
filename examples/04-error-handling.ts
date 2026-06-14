/**
 * Error handling — typed error hierarchy for precise error handling.
 *
 * 错误处理 — 类型化错误层次结构，用于精确的错误处理。
 */
import {
  ClaudeAgent,
  AgentTmuxSdkError,
  AgentTaskError,
  TmuxError,
  TaskTimeoutError,
} from "agent-tmux-sdk";

async function main() {
  const agent = new ClaudeAgent({ timeoutMs: 60_000 });

  try {
    await agent.run("Count bugs and return JSON");
  } catch (error) {
    if (error instanceof TaskTimeoutError) {
      console.error("Task timed out:", error.message);
    } else if (error instanceof AgentTaskError) {
      console.error("Task failed:", error.message);
    } else if (error instanceof TmuxError) {
      console.error("Tmux error:", error.message);
    } else if (error instanceof AgentTmuxSdkError) {
      console.error("SDK error:", error.message);
    }
  }

  await agent.cleanup();
}

main().catch(console.error);

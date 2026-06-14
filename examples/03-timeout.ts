/**
 * Timeout control — limit how long Claude can take.
 *
 * 超时控制 — 限制 Claude 执行时间。
 */
import { ClaudeAgent, TaskTimeoutError } from "agent-tmux-sdk";

async function main() {
  const agent = new ClaudeAgent({ timeoutMs: 5_000 });

  try {
    const output = await agent.run("Analyze the entire repository in detail");
    console.log(output);
  } catch (error) {
    if (error instanceof TaskTimeoutError) {
      console.error("Task timed out:", error.message);
    }
  }

  await agent.cleanup();
}

main().catch(console.error);

/**
 * Task timeout — limit execution time per task or globally.
 *
 * 任务超时 — 按任务或全局限制执行时间。
 */
import { AgentTmuxSdk, TaskTimeoutError } from "agent-tmux-sdk";

async function main() {
  // Global timeout: all tasks default to 30 seconds.
  // 全局超时：所有任务默认 30 秒。
  const sdk = new AgentTmuxSdk({
    taskTimeoutMs: 30_000,
  });

  // Per-task override: this task gets 5 seconds.
  // 单任务覆盖：这个任务有 5 秒。
  try {
    await sdk.runOneShot("Analyze the entire repository in detail", {
      taskId: "quick-check",
      timeoutMs: 5_000,
    });
  } catch (error) {
    if (error instanceof TaskTimeoutError) {
      console.log("Task timed out as expected — checking snapshot:");
      const snapshot = sdk.getTask("quick-check");
      console.log("  State:", snapshot?.state);
      console.log("  Error:", snapshot?.error);
    }
  }

  // Normal task uses the global 30s timeout.
  // 正常任务使用全局 30 秒超时。
  const result = await sdk.runOneShot("What is 2+2?");
  console.log("Result:", result.output);

  await sdk.cleanup();
}

main().catch(console.error);

/**
 * Token-exhaustion recovery — automatic resume when Claude runs out of tokens.
 *
 * Token 耗尽恢复 — Claude 用完 Token 时自动恢复。
 */
import { AgentTmuxSdk } from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk({
    // Allow up to 3 resume attempts on token exhaustion.
    // 允许 Token 耗尽时最多恢复 3 次。
    resumeAttempts: 3,
  });

  const result = await sdk.runOneShot(
    "Perform a detailed analysis of every file in this large repository",
    { taskId: "big-analysis" },
  );

  if (result.resumed) {
    // The task hit token limits but recovered transparently.
    // 任务遇到了 Token 限制但已透明恢复。
    console.log("Task completed after token-exhaustion recovery");
  } else {
    console.log("Task completed without token issues");
  }

  console.log("Output length:", result.output.length, "chars");

  // Disable resume entirely / 完全禁用恢复
  const strictSdk = new AgentTmuxSdk({ resumeAttempts: 0 });

  try {
    await strictSdk.runOneShot("Another big task");
  } catch (error) {
    // Token exhaustion will surface directly as an error.
    // Token 耗尽将直接作为错误抛出。
    console.error("Task failed (no resume):", error);
  } finally {
    await strictSdk.cleanup();
  }

  await sdk.cleanup();
}

main().catch(console.error);

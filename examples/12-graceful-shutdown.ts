/**
 * Graceful shutdown — handle SIGINT/SIGTERM to clean up tmux sessions.
 *
 * 优雅关闭 — 处理 SIGINT/SIGTERM 以清理 tmux 会话。
 */
import { AgentTmuxSdk } from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk({
    poolSize: 3,
    sessionPrefix: "worker",
  });

  // Register shutdown handler / 注册关闭处理器
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, cleaning up...`);
    // cleanup() waits for running tasks, cancels queued ones, stops all sessions.
    // cleanup() 等待运行中的任务，取消排队任务，停止所有会话。
    await sdk.cleanup();
    console.log("All tmux sessions stopped.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Simulate a long-running workload / 模拟长时间运行的工作负载
  const prompts = Array.from({ length: 10 }, (_, i) => `Task ${i + 1}: analyze file_${i}.ts`);

  console.log(`Starting ${prompts.length} tasks across ${3} processes...`);
  console.log("Press Ctrl+C to trigger graceful shutdown.\n");

  const results = await Promise.allSettled(
    prompts.map((prompt, i) => sdk.runOneShot(prompt, { taskId: `work-${i}` })),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  console.log(`\nCompleted: ${succeeded} succeeded, ${failed} failed/cancelled`);

  await sdk.cleanup();
}

main().catch(console.error);

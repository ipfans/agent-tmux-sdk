/**
 * Lifecycle events — monitor task and process state changes.
 *
 * 生命周期事件 — 监控任务和进程状态变化。
 */
import { AgentTmuxSdk } from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk({ poolSize: 2 });

  sdk.on("processStarted", (id) => console.log(`[process] started: ${id}`));
  sdk.on("processStopped", (id) => console.log(`[process] stopped: ${id}`));
  sdk.on("taskQueued", (snap) => console.log(`[task] queued: ${snap.taskId}`));
  sdk.on("taskStarted", (snap) => console.log(`[task] started: ${snap.taskId}`));
  sdk.on("taskCompleted", (result) =>
    console.log(`[task] completed: ${result.taskId} (${result.completedAt - result.startedAt}ms)`),
  );
  sdk.on("taskFailed", (taskId, error) =>
    console.log(`[task] failed: ${taskId} — ${error.message}`),
  );

  await Promise.all([
    sdk.runOneShot("What is 2+2?", { taskId: "math" }),
    sdk.runOneShot("List files in src/", { taskId: "files" }),
  ]);

  await sdk.cleanup();
}

main().catch(console.error);

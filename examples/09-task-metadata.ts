/**
 * Task metadata — attach custom metadata to tasks for tracking and correlation.
 *
 * 任务元数据 — 为任务附加自定义元数据，用于跟踪和关联。
 */
import { AgentTmuxSdk } from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk({ poolSize: 2 });

  const tasks = [
    { file: "src/auth.ts", priority: "high" },
    { file: "src/utils.ts", priority: "low" },
    { file: "src/api.ts", priority: "medium" },
  ];

  const results = await Promise.all(
    tasks.map((meta, i) =>
      sdk.runOneShot(`Review the file ${meta.file}`, {
        taskId: `review-${i}`,
        metadata: { file: meta.file, priority: meta.priority, requestedBy: "ci-pipeline" },
      }),
    ),
  );

  // Metadata is preserved on both results and snapshots.
  // 元数据在结果和快照中都会被保留。
  for (const result of results) {
    const meta = result.metadata as { file: string; priority: string };
    console.log(`[${meta.priority}] ${meta.file}: ${result.output.slice(0, 60)}...`);
  }

  // Snapshots also carry metadata / 快照也携带元数据
  for (const task of tasks.map((_, i) => sdk.getTask(`review-${i}`))) {
    if (task) {
      console.log(`Snapshot ${task.taskId}: state=${task.state}, meta=`, task.metadata);
    }
  }

  await sdk.cleanup();
}

main().catch(console.error);

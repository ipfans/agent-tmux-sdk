/**
 * Process pool — run tasks concurrently across multiple Claude processes.
 *
 * 进程池 — 在多个 Claude 进程间并发执行任务。
 */
import { AgentTmuxSdk } from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk({
    poolSize: 3,
    sessionPrefix: "pool-demo",
  });

  const prompts = [
    "Summarize the README.md",
    "List all exported functions in src/",
    "Check for any TODO comments in the codebase",
    "Count the number of test files",
    "Find all dependencies in package.json",
  ];

  // All 5 tasks run across 3 processes — excess tasks queue automatically.
  // 5 个任务在 3 个进程中运行 — 超出的任务自动排队。
  const results = await Promise.all(
    prompts.map((prompt, i) =>
      sdk.runOneShot(prompt, { taskId: `task-${i + 1}` }),
    ),
  );

  for (const result of results) {
    console.log(`[${result.taskId}] ${result.output.slice(0, 80)}...`);
  }

  // Inspect pool state / 查看进程池状态
  for (const process of sdk.getProcesses()) {
    console.log(`Process ${process.id}: state=${process.state}`);
  }

  await sdk.cleanup();
}

main().catch(console.error);

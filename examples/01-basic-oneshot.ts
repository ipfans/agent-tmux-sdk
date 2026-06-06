/**
 * Basic one-shot execution — the simplest way to run a prompt.
 *
 * 基础即发即忘执行 — 运行 prompt 的最简方式。
 */
import { AgentTmuxSdk } from "agent-tmux-sdk";

async function main() {
  const sdk = new AgentTmuxSdk();

  const result = await sdk.runOneShot("List all TypeScript files in this directory");

  console.log("Task ID:", result.taskId);
  console.log("Output:", result.output);
  console.log("Duration:", result.completedAt - result.startedAt, "ms");

  await sdk.cleanup();
}

main().catch(console.error);

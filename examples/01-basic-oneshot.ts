/**
 * Basic one-shot execution — the simplest way to run a prompt.
 *
 * 基础即发即忘执行 — 运行 prompt 的最简方式。
 */
import { ClaudeAgent } from "agent-tmux-sdk";

async function main() {
  const agent = new ClaudeAgent();

  const output = await agent.run("List all TypeScript files in this directory");
  console.log(output);

  await agent.cleanup();
}

main().catch(console.error);

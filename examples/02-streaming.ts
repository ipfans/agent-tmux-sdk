/**
 * Streaming output — receive Claude's response incrementally.
 *
 * 流式输出 — 逐步接收 Claude 的响应。
 */
import { ClaudeAgent } from "agent-tmux-sdk";

async function main() {
  const agent = new ClaudeAgent();

  for await (const chunk of agent.stream("Explain how async iterables work in TypeScript")) {
    process.stdout.write(chunk);
  }

  console.log("\n--- Done ---");
  await agent.cleanup();
}

main().catch(console.error);

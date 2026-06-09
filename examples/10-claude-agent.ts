/**
 * ClaudeAgent convenience wrapper — simplest API for one-shot prompts.
 *
 * ClaudeAgent 便捷封装 — 用于即发即忘提示的最简 API。
 */
import { AgentTmuxSdk, ClaudeAgent } from "agent-tmux-sdk";

async function main() {
  // Minimal usage with defaults / 使用默认值的最简用法
  const agent = new ClaudeAgent();
  const result = await agent.run("What is the current directory structure?");
  console.log(result.output);

  // With custom SDK configuration / 使用自定义 SDK 配置
  const customAgent = new ClaudeAgent(
    new AgentTmuxSdk({
      poolSize: 2,
      resumeAttempts: 3,
      sessionPrefix: "my-agent",
    }),
  );

  const tasks = ["Summarize README.md", "List all exports"];
  for (const prompt of tasks) {
    const r = await customAgent.run(prompt);
    console.log(`[${r.taskId}] ${r.output.slice(0, 80)}`);
  }
}

main().catch(console.error);

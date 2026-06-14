/**
 * Third-party models via environment variables — point Claude at an
 * Anthropic-compatible provider (DeepSeek, GLM/Zhipu, MiMo/Xiaomi, …). The env
 * vars follow the Claude process (re-applied on every restart/resume), not the
 * tmux shell — they are never `export`ed.
 *
 * 通过环境变量使用第三方模型 — 让 Claude 接入兼容 Anthropic 的服务商（DeepSeek、
 * GLM/智谱、MiMo/小米 等）。环境变量跟随 Claude 进程（每次重启/恢复都会重新应用），
 * 而不是跟随 tmux —— 绝不使用 export。
 */
import {
  AgentTmuxSdk,
  ClaudeAgent,
  anthropicCompatible,
  deepseek,
  glm,
} from "agent-tmux-sdk";

async function main() {
  // 1. Preset helper — returns a plain env map.
  //    预设辅助函数 —— 返回普通的环境变量映射。
  const agent = new ClaudeAgent({
    env: deepseek({ apiKey: process.env.DEEPSEEK_API_KEY ?? "sk-your-key" }),
  });
  const reply = await agent.run("Say hello in one word");
  console.log("DeepSeek reply:", reply);
  await agent.cleanup();

  // 2. Compose a preset with manual overrides (later keys win).
  //    将预设与手动覆盖组合（后写入的键优先）。
  const sdk = new AgentTmuxSdk({
    env: {
      ...glm({ apiKey: process.env.GLM_API_KEY ?? "your-zhipu-key" }),
      // Override the international endpoint, or add unrelated vars.
      // 覆盖为国际版地址，或追加其他变量。
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    },
  });
  const result = await sdk.runOneShot("List two prime numbers");
  console.log("GLM output:", result.output);
  await sdk.cleanup();

  // 3. Any provider via the generic builder (or a hand-written map).
  //    通过通用构造器接入任意服务商（或手写映射）。
  const custom = new AgentTmuxSdk({
    env: anthropicCompatible({
      baseUrl: "https://api.example.com/anthropic",
      apiKey: process.env.CUSTOM_API_KEY ?? "key",
      model: "my-model[1m]",
      fastModel: "my-fast-model",
    }),
  });
  await custom.cleanup();
}

main().catch(console.error);

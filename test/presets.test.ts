import { describe, expect, it } from "vitest";
import { anthropicCompatible, deepseek, glm, mimo } from "../src/index.js";

describe("presets", () => {
  it("deepseek matches the documented config and key order", () => {
    const env = deepseek({ apiKey: "sk-deepseek" });
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
      ANTHROPIC_MODEL: "deepseek-v4-pro[1m]",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro[1m]",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
      CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-v4-flash",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
    });
    expect(Object.keys(env)).toEqual([
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL",
      "CLAUDE_CODE_EFFORT_LEVEL",
    ]);
  });

  it("deepseek honors model/fastModel/effortLevel overrides", () => {
    const env = deepseek({ apiKey: "k", model: "m-pro", fastModel: "m-flash", effortLevel: "high" });
    expect(env.ANTHROPIC_MODEL).toBe("m-pro");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("m-pro");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("m-pro");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("m-flash");
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("m-flash");
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe("high");
  });

  it("glm defaults to the BigModel endpoint and glm models", () => {
    const env = glm({ apiKey: "zhipu" });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(env.ANTHROPIC_MODEL).toBe("glm-5.1");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5.1");
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
  });

  it("glm allows a baseUrl override for the international endpoint", () => {
    const env = glm({ apiKey: "z", baseUrl: "https://api.z.ai/api/anthropic" });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
  });

  it("mimo defaults to the xiaomimimo endpoint and mimo model", () => {
    const env = mimo({ apiKey: "mi" });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.xiaomimimo.com/anthropic");
    expect(env.ANTHROPIC_MODEL).toBe("mimo-v2.5-pro");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("mimo-v2.5-pro");
  });

  it("anthropicCompatible fans out the model and omits effort when unset", () => {
    const env = anthropicCompatible({ baseUrl: "https://api.x/anthropic", apiKey: "k", model: "big" });
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.x/anthropic",
      ANTHROPIC_AUTH_TOKEN: "k",
      ANTHROPIC_MODEL: "big",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "big",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "big",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "big",
      CLAUDE_CODE_SUBAGENT_MODEL: "big",
    });
    expect("CLAUDE_CODE_EFFORT_LEVEL" in env).toBe(false);
  });

  it("composes with manual overrides via spread (later keys win)", () => {
    const env = {
      ...deepseek({ apiKey: "k" }),
      CLAUDE_CODE_EFFORT_LEVEL: "high",
      HTTP_PROXY: "http://127.0.0.1:7890",
    };
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe("high");
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
  });
});

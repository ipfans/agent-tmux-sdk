import type { EnvVars } from "./types.js";

/**
 * Options for {@link anthropicCompatible} — the generic builder for any
 * Anthropic-compatible provider. `glm`, `mimo`, and `deepseek` are thin wrappers
 * over it.
 */
export interface AnthropicCompatibleOptions {
  /** Anthropic-compatible endpoint, e.g. `https://api.deepseek.com/anthropic`. */
  readonly baseUrl: string;
  /** API key, set as `ANTHROPIC_AUTH_TOKEN`. */
  readonly apiKey: string;
  /** Primary model — fills `ANTHROPIC_MODEL` and the opus/sonnet slots. */
  readonly model: string;
  /** Fast model for the haiku slot. Defaults to `model`. */
  readonly fastModel?: string;
  /** Subagent model (`CLAUDE_CODE_SUBAGENT_MODEL`). Defaults to the fast model. */
  readonly subagentModel?: string;
  /** Reasoning effort (`CLAUDE_CODE_EFFORT_LEVEL`, e.g. `"max"`). Omitted if unset. */
  readonly effortLevel?: string;
}

/**
 * Build an env map pointing the `claude` CLI at any Anthropic-compatible endpoint.
 * Pass the result to the SDK's `env` option (or spread it alongside manual vars).
 * Key order is stable and reproduced verbatim in the launch command.
 */
export function anthropicCompatible(options: AnthropicCompatibleOptions): EnvVars {
  const fast = options.fastModel ?? options.model;
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: options.baseUrl,
    ANTHROPIC_AUTH_TOKEN: options.apiKey,
    ANTHROPIC_MODEL: options.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: options.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: options.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
    CLAUDE_CODE_SUBAGENT_MODEL: options.subagentModel ?? fast,
  };
  if (options.effortLevel !== undefined) {
    env.CLAUDE_CODE_EFFORT_LEVEL = options.effortLevel;
  }
  return env;
}

/** Options for {@link deepseek}. */
export interface DeepSeekPresetOptions {
  /** DeepSeek API key. */
  readonly apiKey: string;
  /** Primary model. Defaults to `deepseek-v4-pro[1m]`. */
  readonly model?: string;
  /** Fast/subagent model. Defaults to `deepseek-v4-flash`. */
  readonly fastModel?: string;
  /** Reasoning effort. Defaults to `max`. */
  readonly effortLevel?: string;
}

/**
 * DeepSeek (https://api.deepseek.com/anthropic). Returns the standard env map for
 * driving Claude Code against DeepSeek's Anthropic-compatible endpoint.
 *
 * @example
 * new ClaudeAgent({ env: deepseek({ apiKey: process.env.DEEPSEEK_API_KEY! }) });
 */
export function deepseek(options: DeepSeekPresetOptions): EnvVars {
  return anthropicCompatible({
    baseUrl: "https://api.deepseek.com/anthropic",
    apiKey: options.apiKey,
    model: options.model ?? "deepseek-v4-pro[1m]",
    fastModel: options.fastModel ?? "deepseek-v4-flash",
    effortLevel: options.effortLevel ?? "max",
  });
}

/** Options for {@link glm}. */
export interface GlmPresetOptions {
  /** Zhipu / Z.AI API key. */
  readonly apiKey: string;
  /** Primary model. Defaults to `glm-5.1`. */
  readonly model?: string;
  /** Fast model. Defaults to the primary model (`glm-5.1`). */
  readonly fastModel?: string;
  /**
   * Endpoint override. Defaults to the mainland-China BigModel endpoint
   * `https://open.bigmodel.cn/api/anthropic`; use
   * `https://api.z.ai/api/anthropic` for the international Z.AI endpoint.
   */
  readonly baseUrl?: string;
}

/**
 * GLM / Zhipu (BigModel / Z.AI). Defaults to the mainland-China endpoint; override
 * `baseUrl` for the international Z.AI endpoint. Confirm the endpoint and model ids
 * for your plan/region.
 */
export function glm(options: GlmPresetOptions): EnvVars {
  return anthropicCompatible({
    baseUrl: options.baseUrl ?? "https://open.bigmodel.cn/api/anthropic",
    apiKey: options.apiKey,
    model: options.model ?? "glm-5.1",
    fastModel: options.fastModel ?? options.model ?? "glm-5.1",
  });
}

/** Options for {@link mimo}. */
export interface MimoPresetOptions {
  /** Xiaomi MiMo API key. */
  readonly apiKey: string;
  /** Primary model. Defaults to `mimo-v2.5-pro`. */
  readonly model?: string;
  /** Fast model. Defaults to the primary model. */
  readonly fastModel?: string;
  /**
   * Endpoint override. Defaults to `https://api.xiaomimimo.com/anthropic`; the
   * Token Plan and other regions expose different hosts, so override as needed.
   */
  readonly baseUrl?: string;
}

/**
 * Xiaomi MiMo. Defaults to the pay-as-you-go endpoint; override `baseUrl` for the
 * Token Plan / regional hosts. Confirm the endpoint and model ids for your plan.
 */
export function mimo(options: MimoPresetOptions): EnvVars {
  return anthropicCompatible({
    baseUrl: options.baseUrl ?? "https://api.xiaomimimo.com/anthropic",
    apiKey: options.apiKey,
    model: options.model ?? "mimo-v2.5-pro",
    fastModel: options.fastModel ?? options.model ?? "mimo-v2.5-pro",
  });
}

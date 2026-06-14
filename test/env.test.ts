import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, ClaudeAgent, deepseek } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("environment variables", () => {
  const env = {
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: "sk-1",
  };

  it("passes the configured env to every startClaude call, including bootstrap", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, env });

    await sdk.runOneShot("hi");

    // bootstrap performs two starts (initial + resume-with-sessionId); both carry env.
    expect(tmux.claudeStarts.length).toBeGreaterThanOrEqual(2);
    expect(tmux.claudeStarts.every((s) => s.options.env === env)).toBe(true);

    await sdk.cleanup();
  });

  it("omits env when none is configured", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    await sdk.runOneShot("hi");

    expect(tmux.claudeStarts[0]?.options.env).toBeUndefined();

    await sdk.cleanup();
  });

  it("re-applies env on the token-exhaustion resume start", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      output: "limit",
      resumeWith: { type: "success", output: "continued" },
    });
    const sdk = new AgentTmuxSdk({ tmux, env, resumeAttempts: 1 });

    const result = await sdk.runOneShot("long task");

    expect(result).toMatchObject({ state: "succeeded", resumed: true });
    // The resume relaunches Claude via startClaude with the saved sessionId AND env.
    const resumeStart = tmux.claudeStarts[tmux.claudeStarts.length - 1];
    expect(resumeStart?.options.sessionId).toBeDefined();
    expect(resumeStart?.options.env).toEqual(env);

    await sdk.cleanup();
  });

  it("re-applies env when idle processes restart", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, env, idleRestartMs: 1000 });

    await sdk.runOneShot("warmup");
    const before = tmux.claudeStarts.length;

    await sdk.restartIdleProcesses(Date.now() + 10_000);

    expect(tmux.claudeStarts.length).toBeGreaterThan(before);
    expect(tmux.claudeStarts.slice(before).every((s) => s.options.env === env)).toBe(true);

    await sdk.cleanup();
  });

  it("does not mutate the caller's env object", async () => {
    const tmux = new FakeTmux();
    const original = { ...env };
    const sdk = new AgentTmuxSdk({ tmux, env });

    await sdk.runOneShot("hi");

    expect(env).toEqual(original);

    await sdk.cleanup();
  });

  it("ClaudeAgent forwards its env to the internal SDK", () => {
    const configured = deepseek({ apiKey: "sk-x" });
    const agent = new ClaudeAgent({ env: configured });
    const internal = (agent as unknown as { sdk: { env?: Record<string, string> } }).sdk;
    expect(internal.env).toEqual(configured);
  });
});

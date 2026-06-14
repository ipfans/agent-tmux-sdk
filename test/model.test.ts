import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, ClaudeAgent, RealTmuxAdapter } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("model selection", () => {
  it("passes the configured model to every startClaude call", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, model: "haiku" });

    await sdk.runOneShot("hi");

    expect(tmux.claudeStarts.length).toBeGreaterThan(0);
    expect(tmux.claudeStarts.every((s) => s.options.model === "haiku")).toBe(true);

    await sdk.cleanup();
  });

  it("omits the model when none is configured", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    await sdk.runOneShot("hi");

    expect(tmux.claudeStarts[0]?.options.model).toBeUndefined();

    await sdk.cleanup();
  });

  it("ClaudeAgent forwards its model to the internal SDK", () => {
    const agent = new ClaudeAgent({ model: "claude-opus-4-8[1m]" });
    const internal = (agent as unknown as { sdk: { model?: string } }).sdk;
    expect(internal.model).toBe("claude-opus-4-8[1m]");
  });

  it("RealTmuxAdapter rejects an invalid model format before any tmux call", async () => {
    const adapter = new RealTmuxAdapter();
    // buildClaudeCommand validates and throws before execFileAsync runs, so no
    // tmux session is needed to exercise the guard.
    await expect(
      adapter.startClaude("itest-model-fmt-unused", { model: "bad model; rm -rf", startupTimeoutMs: 50 }),
    ).rejects.toThrow(/Invalid Claude model format/);
  });

  it("RealTmuxAdapter accepts a bracketed model name like claude-opus-4-8[1m]", async () => {
    const adapter = new RealTmuxAdapter();
    // Passes format validation, then fails for an unrelated reason (no such tmux
    // session / tmux absent) — i.e. the bracketed name is NOT rejected as bad
    // format. Guards against the regex being too strict.
    await expect(
      adapter.startClaude("itest-model-fmt-missing", { model: "claude-opus-4-8[1m]", startupTimeoutMs: 50 }),
    ).rejects.not.toThrow(/Invalid Claude model format/);
  });
});

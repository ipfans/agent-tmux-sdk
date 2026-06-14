import { describe, expect, it } from "vitest";
import { AgentTaskError, AgentTmuxSdk, ResultParseError } from "../src/index.js";
import type { FakeExecutionBehavior } from "./fakes/fake-claude.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("result-mode JSON repair loop", () => {
  it("returns the value on a single execution when the first reply is valid", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: '{"a":1}' });
    const sdk = new AgentTmuxSdk({ tmux });

    const result = await sdk.runTask({ prompt: "json", mode: "result" });
    expect(result.result).toEqual({ a: 1 });
    expect(tmux.executions.length).toBe(1);
    await sdk.cleanup();
  });

  it("retries and returns the value once a later reply parses", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "sorry, here is prose not json" });
    tmux.claude.enqueue({ type: "success", output: '{"ok":true}' });
    const sdk = new AgentTmuxSdk({ tmux });

    const result = await sdk.runTask({ prompt: "json", mode: "result" });
    expect(result.result).toEqual({ ok: true });
    expect(tmux.executions.length).toBe(2);
    await sdk.cleanup();
  });

  it("raises ResultParseError after exhausting repair attempts", async () => {
    const tmux = new FakeTmux();
    for (let i = 0; i < 6; i++) {
      tmux.claude.enqueue({ type: "success", output: "still not json" });
    }
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runTask({ prompt: "json", mode: "result" })).rejects.toBeInstanceOf(ResultParseError);
    expect(tmux.executions.length).toBe(4); // initial + 3 repairs
    await sdk.cleanup();
  });

  it("bounds total executions under the ceiling when parse failure compounds with token resume", async () => {
    const tmux = new FakeTmux();
    for (let i = 0; i < 5; i++) {
      tmux.claude.enqueue({
        type: "token-exhausted",
        resumeWith: { type: "success", output: "resumed but still not json" },
      });
    }
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runTask({ prompt: "json", mode: "result" })).rejects.toBeInstanceOf(ResultParseError);
    expect(tmux.executions.length).toBeLessThanOrEqual(8);
    await sdk.cleanup();
  });

  it("hard-bounds total executions at the ceiling even with a high resumeAttempts", async () => {
    const tmux = new FakeTmux();
    // A deep token-exhaustion chain: each resume yields another exhaustion, so
    // only the execution ceiling can stop it — resumeAttempts alone would not.
    let behavior: FakeExecutionBehavior = { type: "success", output: "still not json" };
    for (let i = 0; i < 30; i++) {
      behavior = { type: "token-exhausted", resumeWith: behavior };
    }
    tmux.claude.enqueue(behavior);
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 50 });

    await expect(sdk.runTask({ prompt: "json", mode: "result" })).rejects.toBeInstanceOf(AgentTaskError);
    expect(tmux.executions.length).toBeLessThanOrEqual(8);
    await sdk.cleanup();
  });

  it("does not augment or repair oneshot output", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "not json but fine" });
    const sdk = new AgentTmuxSdk({ tmux });

    const result = await sdk.runOneShot("hello");
    expect(result.output).toBe("not json but fine");
    expect(result.result).toBeUndefined();
    expect(tmux.executions.length).toBe(1);
    await sdk.cleanup();
  });
});

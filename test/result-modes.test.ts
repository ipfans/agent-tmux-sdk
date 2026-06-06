import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, ResultParseError } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("one-shot and result modes", () => {
  it("returns output for one-shot and parsed result data for result mode", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "plain" });
    tmux.claude.enqueue({ type: "success", output: '{"value":3}' });
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runOneShot("plain")).resolves.toMatchObject({ output: "plain", result: undefined });
    await expect(sdk.runTask<{ value: number }>({ prompt: "json", mode: "result" })).resolves.toMatchObject({
      result: { value: 3 },
    });
  });

  it("returns pre-parsed result when the adapter provides it directly", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "raw", result: { pre: "parsed" } });
    const sdk = new AgentTmuxSdk({ tmux });

    const result = await sdk.runTask<{ pre: string }>({ prompt: "pre", mode: "result" });
    expect(result.result).toEqual({ pre: "parsed" });
  });

  it("raises a typed parse error for malformed result output", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "not-json" });
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runTask({ prompt: "json", mode: "result" })).rejects.toBeInstanceOf(ResultParseError);
  });
});

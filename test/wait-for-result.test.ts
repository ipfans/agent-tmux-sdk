import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("waitForResult", () => {
  it("defaults to true when not specified", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    await sdk.runOneShot("hello");

    expect(tmux.executions).toHaveLength(1);
    expect(tmux.executions[0]?.waitForResult).toBe(true);
  });

  it("passes global waitForResult: false to adapter requests", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, waitForResult: false });

    await sdk.runOneShot("hello");

    expect(tmux.executions[0]?.waitForResult).toBe(false);
  });

  it("allows per-task override of global default", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, waitForResult: true });

    await sdk.runOneShot("fire-and-forget", { waitForResult: false });
    await sdk.runOneShot("wait-for-this");

    expect(tmux.executions[0]?.waitForResult).toBe(false);
    expect(tmux.executions[1]?.waitForResult).toBe(true);
  });

  it("per-task true overrides global false", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, waitForResult: false });

    await sdk.runOneShot("need result", { waitForResult: true });
    await sdk.runOneShot("no wait");

    expect(tmux.executions[0]?.waitForResult).toBe(true);
    expect(tmux.executions[1]?.waitForResult).toBe(false);
  });

  it("propagates waitForResult through runTask", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    await sdk.runTask({ prompt: "p", waitForResult: false });

    expect(tmux.executions[0]?.waitForResult).toBe(false);
  });

  it("propagates waitForResult on resume attempts", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      resumeWith: { type: "success", output: "done" },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 1, waitForResult: false });

    await sdk.runOneShot("long");

    expect(tmux.executions.length).toBeGreaterThanOrEqual(2);
    expect(tmux.executions[0]?.waitForResult).toBe(false);
    expect(tmux.executions[1]?.waitForResult).toBe(false);
  });
});

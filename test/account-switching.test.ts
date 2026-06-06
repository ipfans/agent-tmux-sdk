import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, TmuxError } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("account switching", () => {
  it("switches idle processes and applies the new account to later starts without interrupting running work", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ poolSize: 2, account: "a", tmux });
    await sdk.runOneShot("warm");

    tmux.claude.enqueue({ type: "success", output: "slow", delayMs: 5 });
    const running = sdk.runOneShot("running");
    await sdk.switchAccount("b");
    await running;
    await sdk.runOneShot("after");

    expect(tmux.accountSwitches).toEqual([{ sessionName: "agent-tmux-sdk-1", account: "b" }]);
    expect(sdk.getProcesses().every((process) => process.account === "b")).toBe(true);
  });

  it("passes the initial account to Claude startup options", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ account: "initial", tmux });
    await sdk.runOneShot("first");

    expect(tmux.claudeStarts.some((s) => s.options.account === "initial")).toBe(true);
    expect(sdk.getProcesses()[0]?.account).toBe("initial");
  });

  it("skips switching when the process already uses the desired account", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ account: "same", tmux });
    await sdk.runOneShot("warm");
    await sdk.switchAccount("same");

    expect(tmux.accountSwitches).toHaveLength(0);
  });

  it("wraps adapter failures in TmuxError", async () => {
    const tmux = new FakeTmux();
    tmux.failAccountSwitch = true;
    const sdk = new AgentTmuxSdk({ account: "a", tmux });
    await sdk.runOneShot("warm");

    await expect(sdk.switchAccount("b")).rejects.toBeInstanceOf(TmuxError);
  });
});

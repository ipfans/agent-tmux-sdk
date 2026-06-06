import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, AgentTaskError } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("cleanup", () => {
  it("exits Claude then kills tmux sessions, cancels queued work", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "slow", delayMs: 10 });
    const sdk = new AgentTmuxSdk({ poolSize: 1, tmux });

    const running = sdk.runOneShot("running");
    const queued = sdk.runOneShot("queued", { taskId: "queued" });
    await sdk.cleanup();

    await expect(running).resolves.toMatchObject({ state: "succeeded" });
    await expect(queued).rejects.toMatchObject({ name: "AgentTaskError" });
    expect(sdk.getTask("queued")?.state).toBe("cancelled");
    // bootstrap exit + cleanup exit = 2 exits
    const bootstrapExits = 1;
    expect(tmux.claudeExits).toHaveLength(bootstrapExits + 1);
    expect(tmux.sessionKills).toEqual(["agent-tmux-sdk-1"]);
  });

  it("skips already-stopped slots during cleanup", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    await sdk.runOneShot("x");
    await sdk.cleanup();

    expect(tmux.sessionKills).toHaveLength(1);
    expect(sdk.getProcesses()[0]?.state).toBe("stopped");
  });

  it("is idempotent — second cleanup does not throw", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    await sdk.runOneShot("x");
    await sdk.cleanup();
    await sdk.cleanup();

    expect(tmux.sessionKills).toHaveLength(1);
  });

  it("rejects new tasks after cleanup", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    await sdk.cleanup();

    await expect(sdk.runOneShot("nope")).rejects.toBeInstanceOf(AgentTaskError);
  });
});

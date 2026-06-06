import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("lifecycle state", () => {
  it("tracks task and process state through success and failure", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "failure", message: "boom" });
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runTask({ taskId: "bad", prompt: "fail" })).rejects.toMatchObject({
      name: "AgentTaskError",
    });
    expect(sdk.getTask("bad")?.state).toBe("failed");

    const result = await sdk.runTask({ taskId: "good", prompt: "ok" });
    expect(result.state).toBe("succeeded");
    expect(sdk.getTask("good")?.state).toBe("succeeded");
    expect(sdk.getProcesses()[0]?.state).toBe("idle");
  });

  it("returns undefined for unknown task IDs", () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    expect(sdk.getTask("nonexistent")).toBeUndefined();
  });

  it("captures process snapshot with lifecycle metadata", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, account: "test-acct" });

    await sdk.runOneShot("x");

    const processes = sdk.getProcesses();
    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      state: "idle",
      account: "test-acct",
      claudeRunning: true,
    });
    expect(processes[0]?.startedAt).toBeGreaterThan(0);
    expect(processes[0]?.lastUsedAt).toBeGreaterThan(0);
    expect(processes[0]?.claudeSessionId).toBeDefined();
  });

  it("includes task metadata in snapshots and results", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    const result = await sdk.runTask({
      taskId: "meta-task",
      prompt: "with metadata",
      metadata: { source: "test", priority: 1 },
    });

    expect(result.metadata).toEqual({ source: "test", priority: 1 });
    expect(sdk.getTask("meta-task")?.metadata).toEqual({ source: "test", priority: 1 });
  });
});

import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, AgentTaskError, TaskTimeoutError, TmuxError } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("error paths", () => {
  it("wraps startup failures in TmuxError", async () => {
    const tmux = new FakeTmux();
    tmux.failCreateSession = true;
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runOneShot("x")).rejects.toBeInstanceOf(TmuxError);
  });

  it("wraps Claude start failures in TmuxError", async () => {
    const tmux = new FakeTmux();
    tmux.failStartClaude = true;
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runOneShot("x")).rejects.toBeInstanceOf(TmuxError);
  });

  it("fails when token exhaustion cannot be resumed", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      resumeWith: { type: "failure", message: "still exhausted" },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 0 });

    await expect(sdk.runOneShot("x")).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("times out tasks with a typed error", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "late", delayMs: 20 });
    const sdk = new AgentTmuxSdk({ tmux, taskTimeoutMs: 1 });

    await expect(sdk.runOneShot("x")).rejects.toBeInstanceOf(TaskTimeoutError);
  });

  it("collects cleanup failures as TmuxError", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    await sdk.runOneShot("x");
    tmux.failKillSession = true;

    await expect(sdk.cleanup()).rejects.toBeInstanceOf(TmuxError);
  });

  it("rejects duplicate task IDs", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "slow", delayMs: 10 });
    const sdk = new AgentTmuxSdk({ tmux });

    const first = sdk.runOneShot("a", { taskId: "dup" });
    await expect(sdk.runOneShot("b", { taskId: "dup" })).rejects.toBeInstanceOf(AgentTaskError);
    await first;
  });

  it("rejects new tasks after cleanup", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    await sdk.cleanup();

    await expect(sdk.runOneShot("too late")).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("wraps Claude restart failures in TmuxError", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, idleRestartMs: 0 });
    await sdk.runOneShot("warm");
    tmux.failStartClaude = true;

    await expect(sdk.restartIdleProcesses()).rejects.toBeInstanceOf(TmuxError);
  });

  it("wraps exitClaude failures during restart in TmuxError", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, idleRestartMs: 0 });
    await sdk.runOneShot("warm");
    tmux.failExitClaude = true;

    await expect(sdk.restartIdleProcesses()).rejects.toBeInstanceOf(TmuxError);
  });

  it("exits Claude on task timeout so the slot is clean for the next task", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "slow", delayMs: 50 });
    tmux.claude.enqueue({ type: "success", output: "fast" });
    const sdk = new AgentTmuxSdk({ tmux, taskTimeoutMs: 1 });

    await expect(sdk.runOneShot("slow")).rejects.toBeInstanceOf(TaskTimeoutError);
    const exitsAfterTimeout = tmux.claudeExits.length;
    expect(exitsAfterTimeout).toBeGreaterThan(1);
    expect(sdk.getProcesses()[0]?.claudeRunning).toBe(false);
  });

  it("recovers pool capacity after a failed slot start", async () => {
    const tmux = new FakeTmux();
    tmux.failStartClaude = true;
    const sdk = new AgentTmuxSdk({ tmux, poolSize: 1 });

    await expect(sdk.runOneShot("fail")).rejects.toBeInstanceOf(TmuxError);
    tmux.failStartClaude = false;
    const result = await sdk.runOneShot("recover");
    expect(result.output).toContain("ok:");
  });
});

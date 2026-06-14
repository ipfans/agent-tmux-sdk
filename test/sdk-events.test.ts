import { describe, expect, it, vi } from "vitest";
import { AgentTmuxSdk } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("SDK lifecycle events", () => {
  it("emits taskQueued when a task is submitted", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("taskQueued", listener);

    await sdk.runOneShot("hello");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ state: "queued", prompt: "hello" });
  });

  it("emits taskStarted when a task begins execution", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("taskStarted", listener);

    await sdk.runOneShot("hello");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ state: "running" });
  });

  it("emits taskCompleted with TaskResult on success", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "done" });
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("taskCompleted", listener);

    await sdk.runOneShot("hello");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ state: "succeeded", output: "done" });
  });

  it("emits taskFailed with taskId and error on failure", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "failure", message: "boom" });
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("taskFailed", listener);

    await expect(sdk.runOneShot("fail")).rejects.toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
    const [taskId, error] = listener.mock.calls[0] as [string, Error];
    expect(typeof taskId).toBe("string");
    expect(error).toBeInstanceOf(Error);
  });

  it("emits taskResuming with attempt number during token-exhaustion recovery", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      resumeWith: { type: "success", output: "resumed" },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 1 });
    const listener = vi.fn();
    sdk.on("taskResuming", listener);

    await sdk.runOneShot("long");

    expect(listener).toHaveBeenCalledTimes(1);
    const [taskId, attempt] = listener.mock.calls[0] as [string, number];
    expect(typeof taskId).toBe("string");
    expect(attempt).toBe(1);
  });

  it("emits processStarted when a new tmux slot is created", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("processStarted", listener);

    await sdk.runOneShot("hello");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(typeof listener.mock.calls[0]?.[0]).toBe("string");
  });

  it("emits processStopped during cleanup", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("processStopped", listener);

    await sdk.runOneShot("hello");
    await sdk.cleanup();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("emits processError when a slot startup fails", async () => {
    const tmux = new FakeTmux();
    tmux.failStartClaude = true;
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("processError", listener);

    await expect(sdk.runOneShot("fail")).rejects.toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
    const [processId, error] = listener.mock.calls[0] as [string, Error];
    expect(typeof processId).toBe("string");
    expect(error).toBeInstanceOf(Error);
  });

  it("fires events in correct lifecycle order", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const order: string[] = [];

    sdk.on("taskQueued", () => order.push("queued"));
    sdk.on("processStarted", () => order.push("processStarted"));
    sdk.on("taskStarted", () => order.push("started"));
    sdk.on("taskCompleted", () => order.push("completed"));
    sdk.on("processStopped", () => order.push("processStopped"));

    await sdk.runOneShot("hello");
    await sdk.cleanup();

    expect(order).toEqual(["queued", "processStarted", "started", "completed", "processStopped"]);
  });

  it("does not throw when events fire with no listeners", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(sdk.runOneShot("hello")).resolves.toMatchObject({ state: "succeeded" });
    await sdk.cleanup();
  });

  it("supports off() to unsubscribe", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("taskCompleted", listener);
    sdk.off("taskCompleted", listener);

    await sdk.runOneShot("hello");

    expect(listener).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { AgentTmuxSdk, TaskTimeoutError } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

async function drain(iter: AsyncIterable<string>): Promise<void> {
  for await (const chunk of iter) {
    void chunk;
  }
}

describe("streaming", () => {
  it("yields all chunks from the adapter in order", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["hello ", "world", "!"] });
    const sdk = new AgentTmuxSdk({ tmux });

    const chunks: string[] = [];
    for await (const chunk of sdk.runStream("greet")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hello ", "world", "!"]);
  });

  it("emits streamChunk event for each yielded chunk", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["a", "b"] });
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("streamChunk", listener);

    await drain(sdk.runStream("test"));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]?.[1]).toBe("a");
    expect(listener.mock.calls[1]?.[1]).toBe("b");
  });

  it("emits taskStarted and taskCompleted events around the stream", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["done"] });
    const sdk = new AgentTmuxSdk({ tmux });
    const events: string[] = [];
    sdk.on("taskStarted", () => events.push("started"));
    sdk.on("taskCompleted", () => events.push("completed"));

    await drain(sdk.runStream("test"));

    expect(events).toEqual(["started", "completed"]);
  });

  it("returns slot to idle after streaming completes", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["ok"] });
    const sdk = new AgentTmuxSdk({ tmux });

    await drain(sdk.runStream("test"));

    expect(sdk.getProcesses()[0]?.state).toBe("idle");
    expect(sdk.getProcesses()[0]?.currentTaskId).toBeUndefined();
  });

  it("returns slot to idle after streaming errors", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "failure", message: "broken" });
    const sdk = new AgentTmuxSdk({ tmux });

    try {
      await drain(sdk.runStream("fail"));
    } catch {
      // expected
    }

    expect(sdk.getProcesses()[0]?.state).toBe("idle");
  });

  it("emits taskFailed on streaming error", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "failure", message: "boom" });
    const sdk = new AgentTmuxSdk({ tmux });
    const listener = vi.fn();
    sdk.on("taskFailed", listener);

    try {
      await drain(sdk.runStream("fail"));
    } catch {
      // expected
    }

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("uses default stream behavior when no behavior is enqueued", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    const chunks: string[] = [];
    for await (const chunk of sdk.runStream("auto")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["ok:auto"]);
  });

  it("throws when called after cleanup", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    await sdk.cleanup();

    await expect(async () => {
      await drain(sdk.runStream("nope"));
    }).rejects.toThrow("SDK has been cleaned up");
  });

  it("reports accumulated output in taskCompleted", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["a", "b", "c"] });
    const sdk = new AgentTmuxSdk({ tmux });
    let completedOutput: string | undefined;
    sdk.on("taskCompleted", (result) => {
      completedOutput = result.output;
    });

    await drain(sdk.runStream("test"));

    expect(completedOutput).toBe("abc");
  });

  it("times out a slow stream with a typed error", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["slow"], chunkDelayMs: 200 });
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(drain(sdk.runStream("x", { timeoutMs: 10 }))).rejects.toBeInstanceOf(TaskTimeoutError);
    expect(sdk.getProcesses()[0]?.state).toBe("idle");
  });

  it("interrupts the slot when a stream errors", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "failure", message: "boom" });
    const sdk = new AgentTmuxSdk({ tmux });

    await expect(drain(sdk.runStream("fail"))).rejects.toThrow();

    const sessionName = sdk.getProcesses()[0]?.sessionName;
    expect(tmux.claudeInterrupts).toEqual([sessionName]);
  });

  it("interrupts the slot when the consumer breaks early", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["a", "b", "c", "d"] });
    const sdk = new AgentTmuxSdk({ tmux });

    for await (const chunk of sdk.runStream("test")) {
      if (chunk === "b") break;
    }

    expect(tmux.claudeInterrupts).toHaveLength(1);
    expect(sdk.getProcesses()[0]?.state).toBe("idle");
  });

  it("does not interrupt on clean completion", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["done"] });
    const sdk = new AgentTmuxSdk({ tmux });

    await drain(sdk.runStream("test"));

    expect(tmux.claudeInterrupts).toHaveLength(0);
  });

  it("dispatches a task queued behind a stream-held slot", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["a", "b", "c"], chunkDelayMs: 10 });
    tmux.claude.enqueue({ type: "success", output: "queued-result" });
    const sdk = new AgentTmuxSdk({ tmux, poolSize: 1 });

    let queued: Promise<{ output: string }> | undefined;
    for await (const chunk of sdk.runStream("stream")) {
      // Queue a task while the stream is mid-flight and holding the only slot.
      queued ??= sdk.runOneShot("queued", { taskId: "q1" });
      void chunk;
    }

    // The queued task must be picked up once the stream frees the slot — without
    // the dispatch() wake, this await would hang.
    const result = await queued!;
    expect(result.output).toBe("queued-result");
  });
});

import { describe, expect, it, vi } from "vitest";
import { AgentTmuxSdk } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

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

    for await (const _chunk of sdk.runStream("test")) {
      // consume
    }

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

    for await (const _chunk of sdk.runStream("test")) {
      // consume
    }

    expect(events).toEqual(["started", "completed"]);
  });

  it("returns slot to idle after streaming completes", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["ok"] });
    const sdk = new AgentTmuxSdk({ tmux });

    for await (const _chunk of sdk.runStream("test")) {
      // consume
    }

    expect(sdk.getProcesses()[0]?.state).toBe("idle");
    expect(sdk.getProcesses()[0]?.currentTaskId).toBeUndefined();
  });

  it("returns slot to idle after streaming errors", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "failure", message: "broken" });
    const sdk = new AgentTmuxSdk({ tmux });

    const chunks: string[] = [];
    try {
      for await (const chunk of sdk.runStream("fail")) {
        chunks.push(chunk);
      }
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
      for await (const _chunk of sdk.runStream("fail")) {
        // consume
      }
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
      for await (const _chunk of sdk.runStream("nope")) {
        // should not reach
      }
    }).rejects.toThrow("SDK has been cleaned up");
  });
});

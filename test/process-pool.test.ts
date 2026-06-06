import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("process pool", () => {
  it("starts at most poolSize slots and reuses idle sessions", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ poolSize: 2, tmux });

    await sdk.runOneShot("a");
    await sdk.runOneShot("b");
    await sdk.runOneShot("c");

    expect(tmux.sessionCreates).toHaveLength(1);
    // bootstrap dance: start → exit → start with sessionId = 2 starts per slot
    expect(tmux.claudeStarts).toHaveLength(2);
    expect(sdk.getProcesses()).toHaveLength(1);
    expect(sdk.getProcesses()[0]?.state).toBe("idle");
    expect(sdk.getProcesses()[0]?.claudeSessionId).toBeDefined();
  });

  it("fills pool to capacity when tasks arrive concurrently", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "one", delayMs: 10 });
    tmux.claude.enqueue({ type: "success", output: "two", delayMs: 10 });
    const sdk = new AgentTmuxSdk({ poolSize: 2, tmux });

    const [r1, r2] = await Promise.all([
      sdk.runOneShot("a"),
      sdk.runOneShot("b"),
    ]);

    expect(r1.output).toBe("one");
    expect(r2.output).toBe("two");
    expect(tmux.sessionCreates).toHaveLength(2);
    expect(sdk.getProcesses()).toHaveLength(2);
  });

  it("queues beyond pool capacity and drains in order", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "first", delayMs: 5 });
    tmux.claude.enqueue({ type: "success", output: "second" });
    tmux.claude.enqueue({ type: "success", output: "third" });
    const sdk = new AgentTmuxSdk({ poolSize: 1, tmux });

    const results = await Promise.all([
      sdk.runOneShot("a", { taskId: "t1" }),
      sdk.runOneShot("b", { taskId: "t2" }),
      sdk.runOneShot("c", { taskId: "t3" }),
    ]);

    expect(results.map((r) => r.output)).toEqual(["first", "second", "third"]);
    expect(tmux.sessionCreates).toHaveLength(1);
  });

  it("uses configurable sessionPrefix for slot names", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, sessionPrefix: "my-prefix" });

    await sdk.runOneShot("x");

    expect(sdk.getProcesses()[0]?.sessionName).toBe("my-prefix-1");
  });

  it("captures session ID during bootstrap for recovery", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });

    await sdk.runOneShot("x");

    // Bootstrap: start fresh → exit (capture ID) → start with ID
    expect(tmux.claudeExits).toHaveLength(1);
    expect(tmux.claudeStarts).toHaveLength(2);
    const resumeStart = tmux.claudeStarts[1];
    expect(resumeStart?.options.sessionId).toMatch(/^session-/);
    expect(sdk.getProcesses()[0]?.claudeSessionId).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("task execution", () => {
  it("queues saturated work and completes in assignment order", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "one", delayMs: 5 });
    tmux.claude.enqueue({ type: "success", output: "two" });
    const sdk = new AgentTmuxSdk({ poolSize: 1, tmux });

    const first = sdk.runOneShot("first", { taskId: "first" });
    const second = sdk.runOneShot("second", { taskId: "second" });

    expect(sdk.getTask("second")?.state).toBe("queued");
    await expect(first).resolves.toMatchObject({ output: "one" });
    await expect(second).resolves.toMatchObject({ output: "two" });
    expect(tmux.executions.map((request) => request.prompt)).toEqual(["first", "second"]);
  });
});

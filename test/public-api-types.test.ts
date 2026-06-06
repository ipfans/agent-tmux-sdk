import { describe, expectTypeOf, it } from "vitest";
import {
  AgentTmuxSdk,
  AgentTaskError,
  TmuxError,
  type AgentTmuxSdkOptions,
  type ClaudeSessionId,
  type ProcessSnapshot,
  type ProcessState,
  type TaskMode,
  type TaskResult,
  type TaskState,
} from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("public API types", () => {
  it("exports SDK configuration and lifecycle types", () => {
    expectTypeOf<ProcessState>().toEqualTypeOf<
      "idle" | "starting" | "busy" | "restarting" | "stopped" | "failed"
    >();
    expectTypeOf<TaskState>().toEqualTypeOf<
      "queued" | "running" | "resuming" | "succeeded" | "failed" | "cancelled"
    >();
    expectTypeOf<TaskMode>().toEqualTypeOf<"oneshot" | "result">();
    expectTypeOf<ClaudeSessionId>().toEqualTypeOf<string>();

    const options: AgentTmuxSdkOptions = {
      poolSize: 2,
      idleRestartMs: 10,
      tmux: new FakeTmux(),
      account: "work",
    };
    const sdk = new AgentTmuxSdk(options);
    expectTypeOf(sdk.runOneShot).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(sdk.runTask<{ ok: true }>).returns.toEqualTypeOf<Promise<TaskResult<{ ok: true }>>>();
    expectTypeOf(new TmuxError("x")).toEqualTypeOf<TmuxError>();
    expectTypeOf(new AgentTaskError("x")).toEqualTypeOf<AgentTaskError>();

    type HasClaudeFields = Pick<ProcessSnapshot, "claudeSessionId" | "claudeRunning">;
    expectTypeOf<HasClaudeFields>().toMatchTypeOf<{ claudeSessionId?: string; claudeRunning: boolean }>();
  });
});

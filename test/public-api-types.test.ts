import { describe, expectTypeOf, it } from "vitest";
import {
  AgentTmuxSdk,
  AgentTaskError,
  ClaudeAgent,
  TmuxError,
  type AgentTmuxSdkOptions,
  type ClaudeAgentOptions,
  type ClaudeStartOptions,
  type EnvVars,
  type ProcessSnapshot,
  type ProcessState,
  type RunStreamOptions,
  type RunTaskOptions,
  type SchemaLike,
  type SdkEventMap,
  type TaskMode,
  type TaskResult,
  type TaskState,
} from "../src/index.js";
import { z } from "zod";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("public API types", () => {
  it("exports SDK lifecycle types", () => {
    expectTypeOf<ProcessState>().toEqualTypeOf<
      "idle" | "starting" | "busy" | "restarting" | "stopped" | "failed"
    >();
    expectTypeOf<TaskState>().toEqualTypeOf<
      "queued" | "running" | "resuming" | "succeeded" | "failed" | "cancelled"
    >();
    expectTypeOf<TaskMode>().toEqualTypeOf<"oneshot" | "result">();
  });

  it("exports AgentTmuxSdk with correct method signatures", () => {
    const options: AgentTmuxSdkOptions = {
      poolSize: 2,
      idleRestartMs: 10,
      tmux: new FakeTmux(),
    };
    const sdk = new AgentTmuxSdk(options);
    expectTypeOf(sdk.runOneShot).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(sdk.runTask<{ ok: true }>).returns.toEqualTypeOf<Promise<TaskResult<{ ok: true }>>>();
    expectTypeOf(sdk.on).parameter(0).toMatchTypeOf<string>();
  });

  it("infers the result type from a schema and exposes SchemaLike", () => {
    expectTypeOf<RunTaskOptions>().toHaveProperty("schema");
    expectTypeOf<SchemaLike<{ a: number }>>().toHaveProperty("safeParse");

    const sdk = new AgentTmuxSdk({ tmux: new FakeTmux() });
    const schema = z.object({ sum: z.number() });
    const promise = sdk.runTask({ prompt: "x", mode: "result", schema });
    expectTypeOf(promise).toEqualTypeOf<Promise<TaskResult<{ sum: number }>>>();
  });

  it("exports ClaudeAgent with beginner-friendly API", () => {
    expectTypeOf<ClaudeAgentOptions>().toHaveProperty("workingDirectory");
    expectTypeOf<ClaudeAgentOptions>().toHaveProperty("timeoutMs");
    const agent = new ClaudeAgent();
    expectTypeOf(agent.run).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(agent.run).returns.toEqualTypeOf<Promise<string>>();
  });

  it("exposes the env option on the option types and the EnvVars alias", () => {
    expectTypeOf<AgentTmuxSdkOptions>().toHaveProperty("env");
    expectTypeOf<ClaudeAgentOptions>().toHaveProperty("env");
    expectTypeOf<ClaudeStartOptions>().toHaveProperty("env");
    expectTypeOf<EnvVars>().toEqualTypeOf<Readonly<Record<string, string>>>();
  });

  it("exports error hierarchy", () => {
    expectTypeOf(new TmuxError("x")).toEqualTypeOf<TmuxError>();
    expectTypeOf(new AgentTaskError("x")).toEqualTypeOf<AgentTaskError>();
  });

  it("exports SdkEventMap for typed event subscriptions", () => {
    expectTypeOf<SdkEventMap>().toHaveProperty("taskQueued");
    expectTypeOf<SdkEventMap>().toHaveProperty("taskCompleted");
    expectTypeOf<SdkEventMap>().toHaveProperty("streamChunk");
  });

  it("exports RunStreamOptions", () => {
    expectTypeOf<RunStreamOptions>().toHaveProperty("workingDirectory");
    expectTypeOf<RunStreamOptions>().toHaveProperty("timeoutMs");
  });

  it("ProcessSnapshot does not have account field", () => {
    type Keys = keyof ProcessSnapshot;
    expectTypeOf<"account" extends Keys ? true : false>().toEqualTypeOf<false>();
  });
});

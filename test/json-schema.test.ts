import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentTaskError, AgentTmuxSdk, ResultParseError } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("result-mode schema validation", () => {
  it("returns a validated, typed result for a matching reply", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: '{"sum": 4}' });
    const sdk = new AgentTmuxSdk({ tmux });
    const schema = z.object({ sum: z.number() });

    const result = await sdk.runTask({ prompt: "what is 2+2 as json", mode: "result", schema });
    // Type-level: result.result is inferred as { sum: number } | undefined.
    expect(result.result?.sum).toBe(4);
    await sdk.cleanup();
  });

  it("retries with the validation error folded into the re-prompt", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: '{"sum": "four"}' }); // wrong type
    tmux.claude.enqueue({ type: "success", output: '{"sum": 4}' });
    const sdk = new AgentTmuxSdk({ tmux });
    const schema = z.object({ sum: z.number() });

    const result = await sdk.runTask({ prompt: "sum", mode: "result", schema });
    expect(result.result).toEqual({ sum: 4 });
    expect(tmux.executions.length).toBe(2);
    const repairPrompt = tmux.executions[1]?.prompt ?? "";
    expect(repairPrompt.toLowerCase()).toContain("json");
    await sdk.cleanup();
  });

  it("accepts any validator exposing a conforming safeParse (no zod required)", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: '{"n": 7}' });
    const sdk = new AgentTmuxSdk({ tmux });
    const schema = {
      safeParse(input: unknown) {
        if (input !== null && typeof input === "object" && typeof (input as { n?: unknown }).n === "number") {
          return { success: true as const, data: input as { n: number } };
        }
        return { success: false as const, error: "n must be a number" };
      },
    };

    const result = await sdk.runTask({ prompt: "n", mode: "result", schema });
    expect(result.result?.n).toBe(7);
    await sdk.cleanup();
  });

  it("raises a typed error when the schema lacks a safeParse method", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: '{"x": 1}' });
    const sdk = new AgentTmuxSdk({ tmux });
    const badSchema = {} as unknown as {
      safeParse(input: unknown): { success: true; data: unknown } | { success: false; error: unknown };
    };

    await expect(
      sdk.runTask({ prompt: "x", mode: "result", schema: badSchema }),
    ).rejects.toBeInstanceOf(AgentTaskError);
    await sdk.cleanup();
  });

  it("raises ResultParseError when validation never passes", async () => {
    const tmux = new FakeTmux();
    for (let i = 0; i < 6; i++) {
      tmux.claude.enqueue({ type: "success", output: '{"sum": "nope"}' });
    }
    const sdk = new AgentTmuxSdk({ tmux });
    const schema = z.object({ sum: z.number() });

    await expect(sdk.runTask({ prompt: "sum", mode: "result", schema })).rejects.toBeInstanceOf(ResultParseError);
    await sdk.cleanup();
  });

  it("skips validation and returns untyped JSON when no schema is supplied", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: '{"anything": [1, 2, 3]}' });
    const sdk = new AgentTmuxSdk({ tmux });

    const result = await sdk.runTask({ prompt: "json", mode: "result" });
    expect(result.result).toEqual({ anything: [1, 2, 3] });
    await sdk.cleanup();
  });
});

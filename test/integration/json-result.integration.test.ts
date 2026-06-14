import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentTmuxSdk } from "../../src/index.js";
import { integration, integrationModel, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
// This is the suite that fails against the pre-overhaul SDK (raw JSON.parse on
// the whole pane), confirming it exercises the extraction/repair/validation path.
describe.skipIf(!integration.enabled)("integration: JSON result mode", () => {
  it("returns a schema-validated object with a computable value", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("json") });
    const schema = z.object({ sum: z.number() });
    try {
      const result = await sdk.runTask({
        prompt: "Add 2 and 2. Return an object with a single field `sum` holding the numeric result.",
        mode: "result",
        schema,
      });
      expect(result.result?.sum).toBe(4);
    } finally {
      await sdk.cleanup();
    }
  });

  it("captures and extracts a multi-screen JSON result", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("json-large") });
    const schema = z.object({ items: z.array(z.object({ i: z.number() })) });
    try {
      const result = await sdk.runTask({
        prompt:
          'Return an object with a field `items`: an array of 40 objects, each {"i": n} for n from 1 to 40, in order.',
        mode: "result",
        schema,
      });
      expect(result.result?.items).toHaveLength(40);
    } finally {
      await sdk.cleanup();
    }
  });

  it("scopes extraction to the current task across a reused slot", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, poolSize: 1, sessionPrefix: uniquePrefix("json-reuse") });
    const firstSchema = z.object({ a: z.number() });
    const secondSchema = z.object({ b: z.number() });
    try {
      const first = await sdk.runTask({
        prompt: 'Return {"a": 1} and nothing else.',
        mode: "result",
        schema: firstSchema,
      });
      const second = await sdk.runTask({
        prompt: 'Return {"b": 2} and nothing else.',
        mode: "result",
        schema: secondSchema,
      });
      expect(first.result?.a).toBe(1);
      expect(second.result?.b).toBe(2);
    } finally {
      await sdk.cleanup();
    }
  });

  it("generates a large nested JSON payload validated by a complex schema", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("json-big") });
    const schema = z.object({
      users: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          email: z.string(),
          roles: z.array(z.string()),
          active: z.boolean(),
          note: z.string(),
        }),
      ),
    });
    try {
      const result = await sdk.runTask({
        prompt:
          'Return a JSON object with a single key "users" whose value is an array of exactly ' +
          '20 objects, id from 1 to 20 in order. Each object has: id (number), name "user-<id>", ' +
          'email "<id>@example.com", roles (an array of exactly 2 strings), active (boolean), and ' +
          'note set to the literal string: has {braces} and [brackets]. Output only the JSON.',
        mode: "result",
        schema,
      });
      // Stresses wide-pane no-wrap, multi-screen scrollback reassembly, and the
      // quote-aware bracket scanner: the braces and brackets live INSIDE a string
      // value and must not be mistaken for JSON structure during extraction.
      expect(result.result?.users).toHaveLength(20);
      expect(result.result?.users[0]?.id).toBe(1);
      expect(result.result?.users[19]?.id).toBe(20);
      expect(result.result?.users[0]?.note).toContain("{braces}");
      expect(result.result?.users[0]?.note).toContain("[brackets]");
    } finally {
      await sdk.cleanup();
    }
  });

  it("converges after a forced repair re-prompt", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("json-repair") });
    const real = z.object({ value: z.number() });
    let calls = 0;
    // Reject the first validation unconditionally to force exactly one repair
    // re-prompt, then defer to the real schema — proving the repair instruction
    // round-trips through real Claude (there is no event to observe it otherwise).
    const forcing = {
      safeParse(
        input: unknown,
      ): { success: true; data: { value: number } } | { success: false; error: unknown } {
        calls += 1;
        if (calls === 1) {
          return { success: false, error: { issues: [{ path: ["value"], message: "forced repair" }] } };
        }
        const parsed = real.safeParse(input);
        return parsed.success
          ? { success: true, data: parsed.data }
          : { success: false, error: parsed.error };
      },
    };
    try {
      const result = await sdk.runTask({
        prompt: 'Return {"value": 7} and nothing else.',
        mode: "result",
        schema: forcing,
      });
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(result.result?.value).toBe(7);
    } finally {
      await sdk.cleanup();
    }
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentTmuxSdk } from "../../src/index.js";
import { integration, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
// This is the suite that fails against the pre-overhaul SDK (raw JSON.parse on
// the whole pane), confirming it exercises the extraction/repair/validation path.
describe.skipIf(!integration.enabled)("integration: JSON result mode", () => {
  it("returns a schema-validated object with a computable value", async () => {
    const sdk = new AgentTmuxSdk({ sessionPrefix: uniquePrefix("json") });
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
    const sdk = new AgentTmuxSdk({ sessionPrefix: uniquePrefix("json-large") });
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
    const sdk = new AgentTmuxSdk({ poolSize: 1, sessionPrefix: uniquePrefix("json-reuse") });
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
});

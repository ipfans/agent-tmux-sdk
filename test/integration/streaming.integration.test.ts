import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../../src/index.js";
import { integration, integrationModel, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
// Exercises the adapter's real stream() path — the poll loop, UI-chrome
// stripping (responseRegion), and append-only delta computation (appendDelta) —
// none of which the fake stream (preset chunks) can reproduce.
describe.skipIf(!integration.enabled)("integration: streaming", () => {
  it("yields the response in order without leaking UI chrome", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("stream") });
    try {
      const chunks: string[] = [];
      for await (const chunk of sdk.runStream(
        "Print the numbers 1 to 5, one per line, and nothing else.",
      )) {
        chunks.push(chunk);
      }
      const joined = chunks.join("");
      expect(chunks.length).toBeGreaterThan(0);
      // Delta computation kept the response ordered (1 streamed before 5)...
      expect(joined).toContain("1");
      expect(joined).toContain("5");
      expect(joined.indexOf("1")).toBeLessThan(joined.indexOf("5"));
      // ...and Claude's input-box chrome was stripped rather than streamed.
      expect(joined).not.toContain("esc to interrupt");
    } finally {
      await sdk.cleanup();
    }
  });

  it("recovers the slot after an early break and reuses it", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, poolSize: 1, sessionPrefix: uniquePrefix("stream-break") });
    try {
      // Consume a single chunk then bail: the runStream finally interrupts the
      // mid-response turn (Escape) so the slot returns clean to the pool.
      const seen: string[] = [];
      for await (const chunk of sdk.runStream("Count from 1 to 30, one number per line.")) {
        seen.push(chunk);
        break;
      }
      expect(seen.length).toBe(1);
      // The interrupted slot must be reusable for the next task.
      const result = await sdk.runOneShot("Reply with exactly the word: RECOVERED (nothing else).");
      expect(result.output.toUpperCase()).toContain("RECOVERED");
    } finally {
      await sdk.cleanup();
    }
  });
});

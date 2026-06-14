import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../../src/index.js";
import { integration, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
describe.skipIf(!integration.enabled)("integration: text output", () => {
  it("runOneShot returns non-empty text containing the requested token", async () => {
    const sdk = new AgentTmuxSdk({ sessionPrefix: uniquePrefix("oneshot") });
    try {
      const result = await sdk.runOneShot("Reply with exactly the word: OK (nothing else).");
      expect(result.output.length).toBeGreaterThan(0);
      expect(result.output.toUpperCase()).toContain("OK");
    } finally {
      await sdk.cleanup();
    }
  });

  it("runTask oneshot mode returns text via the full API", async () => {
    const sdk = new AgentTmuxSdk({ sessionPrefix: uniquePrefix("text") });
    try {
      const result = await sdk.runTask({
        prompt: "Reply with exactly the word: READY (nothing else).",
        mode: "oneshot",
      });
      expect(result.mode).toBe("oneshot");
      expect(result.output.toUpperCase()).toContain("READY");
    } finally {
      await sdk.cleanup();
    }
  });
});

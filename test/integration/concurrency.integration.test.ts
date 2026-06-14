import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../../src/index.js";
import { integration, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
describe.skipIf(!integration.enabled)("integration: controlled concurrency", () => {
  it("caps simultaneous execution at poolSize under a 10-task burst", async () => {
    const sdk = new AgentTmuxSdk({ poolSize: 3, sessionPrefix: uniquePrefix("pool") });

    let running = 0;
    let peak = 0;
    sdk.on("taskStarted", () => {
      running += 1;
      peak = Math.max(peak, running);
    });
    sdk.on("taskCompleted", () => {
      running -= 1;
    });
    sdk.on("taskFailed", () => {
      running -= 1;
    });

    try {
      // Pre-warm all 3 slots so the peak is deterministic — serialized cold
      // start could otherwise let a fast task finish before the 3rd slot boots,
      // leaving the observed peak at 2.
      await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          sdk.runOneShot("Reply with exactly: OK", { taskId: `warm-${i}` }),
        ),
      );
      expect(running).toBe(0);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          sdk.runOneShot("Reply with exactly: OK", { taskId: `burst-${i}` }),
        ),
      );

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.output.length > 0)).toBe(true);
      // Cap is respected (never exceeded) and reached (pool fully utilized).
      expect(peak).toBe(3);
    } finally {
      await sdk.cleanup();
    }
  });
});

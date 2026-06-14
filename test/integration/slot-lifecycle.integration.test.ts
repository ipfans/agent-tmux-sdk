import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, TaskTimeoutError } from "../../src/index.js";
import { integration, integrationModel, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
// Validates that a slot survives real exit/restart cycles — recovery after a
// per-task timeout abandons a turn mid-response, and a deliberate idle restart —
// and stays usable afterwards. Fakes cannot prove a real session recovers.
describe.skipIf(!integration.enabled)("integration: slot lifecycle", () => {
  it("recovers the slot after a task timeout and runs the next task", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, poolSize: 1, sessionPrefix: uniquePrefix("timeout") });
    try {
      // A 100ms turn timeout fires well before any real response (slot startup
      // happens before the timeout wrapper), abandoning the turn mid-response.
      await expect(
        sdk.runOneShot("Reply with exactly the word: OK (nothing else).", { timeoutMs: 100 }),
      ).rejects.toBeInstanceOf(TaskTimeoutError);
      // The SDK exits Claude to recover; the next task must succeed on the same slot.
      const result = await sdk.runOneShot("Reply with exactly the word: RECOVERED (nothing else).");
      expect(result.output.toUpperCase()).toContain("RECOVERED");
    } finally {
      await sdk.cleanup();
    }
  });

  it("restartIdleProcesses cycles Claude and the slot stays usable", async () => {
    const sdk = new AgentTmuxSdk({
      model: integrationModel,
      poolSize: 1,
      idleRestartMs: 1,
      sessionPrefix: uniquePrefix("idle"),
    });
    try {
      await sdk.runOneShot("Reply with exactly the word: FIRST (nothing else).");
      // Let the (1ms) idle threshold elapse, then force a real exit + bootstrap.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await sdk.restartIdleProcesses();
      expect(sdk.getProcesses()[0]?.state).toBe("idle");
      const result = await sdk.runOneShot("Reply with exactly the word: SECOND (nothing else).");
      expect(result.output.toUpperCase()).toContain("SECOND");
    } finally {
      await sdk.cleanup();
    }
  });
});

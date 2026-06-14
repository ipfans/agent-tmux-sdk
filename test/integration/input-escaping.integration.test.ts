import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../../src/index.js";
import { integration, integrationModel, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
// Validates the adapter's literal send-keys path (`-l --`): a prompt starting
// with "-" must not be parsed as a tmux flag, and shell metacharacters must be
// sent verbatim (execFile uses no shell). Fakes bypass send-keys entirely, so
// the escaping can only be proven against real tmux. The prompts are framed as
// ordinary questions — answering them correctly proves verbatim delivery, and it
// avoids the prompt-injection refusals that "ignore X / reply with exactly Y"
// phrasing triggers.
describe.skipIf(!integration.enabled)("integration: input escaping", () => {
  it("delivers a prompt that starts with a dash", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("dash") });
    try {
      // Starts with "-50": without the adapter's `send-keys -- ` the tmux call
      // would parse the leading dash as flags and fail, so a correct answer (42)
      // proves the prompt reached Claude verbatim.
      const result = await sdk.runOneShot("-50 plus 92 equals what? Reply with only the number.");
      expect(result.output).toContain("42");
    } finally {
      await sdk.cleanup();
    }
  });

  it("delivers shell metacharacters literally", async () => {
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("meta") });
    try {
      // execFile (no shell) + `send-keys -l` send $ | & ; verbatim. A coherent
      // yes/no answer about the pipe proves they arrived intact rather than being
      // interpreted by a shell or dropped.
      const result = await sdk.runOneShot(
        "Does this text contain a pipe symbol? Answer only YES or NO: a $b | c & d ;",
      );
      expect(result.output.toUpperCase()).toContain("YES");
    } finally {
      await sdk.cleanup();
    }
  });
});

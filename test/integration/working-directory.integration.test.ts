import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentTmuxSdk } from "../../src/index.js";
import { integration, integrationModel, uniquePrefix } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
// Validates that workingDirectory is applied via a real `/cd` before the prompt
// (the unit suite only asserts the command string was sent). A unique marker
// file confirms Claude actually resolved a relative path in that directory.
describe.skipIf(!integration.enabled)("integration: working directory", () => {
  it("runs the task in the requested workingDirectory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "itest-cd-"));
    const token = `MARKER-${uniquePrefix("cd")}`;
    await writeFile(join(dir, "marker.txt"), token);
    const sdk = new AgentTmuxSdk({ model: integrationModel, sessionPrefix: uniquePrefix("cd") });
    try {
      const result = await sdk.runOneShot(
        "Read the file marker.txt in the current directory and reply with its exact contents and nothing else.",
        { workingDirectory: dir },
      );
      expect(result.output).toContain(token);
    } finally {
      await sdk.cleanup();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

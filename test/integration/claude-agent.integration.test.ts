import { describe, expect, it } from "vitest";
import { ClaudeAgent } from "../../src/index.js";
import { integration, integrationModel } from "./support.js";

// Real tmux + Claude. Opt-in: `pnpm test:integration`.
// The beginner-facing wrapper (run/stream + async disposal) has unit coverage
// but no end-to-end test. ClaudeAgent takes no sessionPrefix; the integration
// suite runs serially (fileParallelism: false) so the default prefix is safe.
describe.skipIf(!integration.enabled)("integration: ClaudeAgent", () => {
  it("run() returns text and disposes", async () => {
    const agent = new ClaudeAgent({ model: integrationModel });
    try {
      const output = await agent.run("Reply with exactly the word: PONG (nothing else).");
      expect(output.toUpperCase()).toContain("PONG");
    } finally {
      // Exercise the AsyncDisposable cleanup path (the `await using` target).
      await agent[Symbol.asyncDispose]();
    }
  });

  it("stream() yields chunks", async () => {
    const agent = new ClaudeAgent({ model: integrationModel });
    try {
      const chunks: string[] = [];
      for await (const chunk of agent.stream(
        "Print the numbers 1 to 3, one per line, and nothing else.",
      )) {
        chunks.push(chunk);
      }
      const joined = chunks.join("");
      expect(chunks.length).toBeGreaterThan(0);
      expect(joined).toContain("3");
    } finally {
      await agent.cleanup();
    }
  });
});

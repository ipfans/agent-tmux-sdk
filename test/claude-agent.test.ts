import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, ClaudeAgent } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("ClaudeAgent convenience wrapper", () => {
  it("delegates prompts to an SDK one-shot task", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "wrapped" });
    const agent = new ClaudeAgent(new AgentTmuxSdk({ tmux }));

    await expect(agent.run("hello")).resolves.toMatchObject({ output: "wrapped" });
  });
});

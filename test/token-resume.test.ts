import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, AgentTaskError } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("token exhaustion resume", () => {
  it("resumes token-exhausted tasks using exitClaude + startClaude with sessionId", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      output: "limit",
      resumeWith: { type: "success", output: "continued" },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 1 });

    const result = await sdk.runOneShot("long task", { taskId: "resume-me" });

    expect(result).toMatchObject({ state: "succeeded", output: "continued", resumed: true });
    expect(sdk.getTask("resume-me")?.state).toBe("succeeded");
    // bootstrap exit + token-exhaustion exit = 2 exits
    const bootstrapExits = 1;
    expect(tmux.claudeExits).toHaveLength(bootstrapExits + 1);
    // token-exhaustion resume calls startClaude with sessionId
    const resumeStart = tmux.claudeStarts[tmux.claudeStarts.length - 1];
    expect(resumeStart?.options.sessionId).toBeDefined();
  });

  it("sends 'continue' as the prompt on resume", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      resumeWith: { type: "success", output: "done" },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 1 });

    await sdk.runOneShot("original prompt");

    const resumeExecution = tmux.executions.find((e) => e.prompt === "continue");
    expect(resumeExecution).toBeDefined();
  });

  it("fails after exhausting all configured resume attempts", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      resumeWith: {
        type: "token-exhausted",
        resumeWith: { type: "success", output: "never reached" },
      },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 1 });

    await expect(sdk.runOneShot("exhaust")).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("supports configurable multiple resume attempts", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      resumeWith: {
        type: "token-exhausted",
        resumeWith: { type: "success", output: "recovered" },
      },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 2 });

    const result = await sdk.runOneShot("multi-resume");
    expect(result).toMatchObject({ state: "succeeded", output: "recovered", resumed: true });
    // bootstrap exit + 2 token-exhaustion exits = 3
    const bootstrapExits = 1;
    expect(tmux.claudeExits).toHaveLength(bootstrapExits + 2);
  });

  it("does not resume when resumeAttempts is zero", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      resumeWith: { type: "success", output: "unreachable" },
    });
    const sdk = new AgentTmuxSdk({ tmux, resumeAttempts: 0 });
    const bootstrapExits = 1;

    await expect(sdk.runOneShot("no-resume")).rejects.toBeInstanceOf(AgentTaskError);
    expect(tmux.claudeExits).toHaveLength(bootstrapExits);
  });
});

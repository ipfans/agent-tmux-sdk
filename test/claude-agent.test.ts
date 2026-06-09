import { describe, expect, it } from "vitest";
import { AgentTmuxSdk, ClaudeAgent } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("ClaudeAgent", () => {
  it("run() returns the output string directly", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "hello world" });
    const sdk = new AgentTmuxSdk({ tmux });
    const agent = new ClaudeAgent();
    // Override internal sdk for testing via prototype
    Object.assign(agent, { sdk });

    const result = await agent.run("greet");

    expect(result).toBe("hello world");
  });

  it("stream() yields chunks as AsyncIterable<string>", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "stream", chunks: ["a", "b", "c"] });
    const sdk = new AgentTmuxSdk({ tmux });
    const agent = new ClaudeAgent();
    Object.assign(agent, { sdk });

    const chunks: string[] = [];
    for await (const chunk of agent.stream("test")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["a", "b", "c"]);
  });

  it("constructs with default options", () => {
    const agent = new ClaudeAgent();
    expect(agent).toBeInstanceOf(ClaudeAgent);
  });

  it("constructs with beginner-level options", () => {
    const agent = new ClaudeAgent({
      workingDirectory: "/tmp",
      timeoutMs: 5000,
    });
    expect(agent).toBeInstanceOf(ClaudeAgent);
  });

  it("cleanup() stops the underlying tmux session", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const agent = new ClaudeAgent();
    Object.assign(agent, { sdk });

    await agent.run("warm up");
    await agent.cleanup();

    expect(tmux.sessionKills).toHaveLength(1);
  });

  it("cleanup() is idempotent", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const agent = new ClaudeAgent();
    Object.assign(agent, { sdk });

    await agent.run("warm up");
    await agent.cleanup();
    await agent.cleanup();

    expect(tmux.sessionKills).toHaveLength(1);
  });

  it("Symbol.asyncDispose calls cleanup", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const agent = new ClaudeAgent();
    Object.assign(agent, { sdk });

    await agent.run("warm up");
    await agent[Symbol.asyncDispose]();

    expect(tmux.sessionKills).toHaveLength(1);
  });

  it("multiple sequential run() calls reuse the same session", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux });
    const agent = new ClaudeAgent();
    Object.assign(agent, { sdk });

    await agent.run("first");
    await agent.run("second");
    await agent.run("third");

    expect(tmux.sessionCreates).toHaveLength(1);
  });
});

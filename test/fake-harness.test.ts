import { describe, expect, it } from "vitest";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("fake tmux/fake Claude harness", () => {
  it("creates session, starts Claude, executes, exits Claude, kills session", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({ type: "success", output: "done", result: { ok: true } });

    const handle = await tmux.createSession("s1");
    await tmux.startClaude("s1", { account: "a" });
    const result = await tmux.execute(handle.sessionName, {
      taskId: "t1",
      prompt: "work",
      mode: "result",
    });
    await tmux.switchAccount(handle.sessionName, "b");
    const sessionId = await tmux.exitClaude("s1");
    await tmux.killSession(handle.sessionName);

    expect(result).toMatchObject({ exitCode: 0, output: "done", result: { ok: true } });
    expect(sessionId).toMatch(/^session-/);
    expect(tmux.accountSwitches).toEqual([{ sessionName: "s1", account: "b" }]);
    expect(tmux.sessions.has("s1")).toBe(false);
  });

  it("tracks token-exhausted behavior and resume flow", async () => {
    const tmux = new FakeTmux();
    tmux.claude.enqueue({
      type: "token-exhausted",
      output: "limit hit",
      resumeWith: { type: "success", output: "resumed" },
    });

    const exhausted = await tmux.execute("s1", {
      taskId: "t1",
      prompt: "long",
      mode: "oneshot",
    });
    expect(exhausted.tokenExhausted).toBe(true);
    expect(exhausted.sessionId).toBeDefined();

    const resumed = await tmux.execute("s1", {
      taskId: "t1",
      prompt: "continue",
      mode: "oneshot",
    });
    expect(resumed.exitCode).toBe(0);
    expect(resumed.output).toBe("resumed");
  });

  it("supports Claude resume via session ID", async () => {
    const tmux = new FakeTmux();
    await tmux.createSession("s1");
    await tmux.startClaude("s1", {});
    const sessionId = await tmux.exitClaude("s1");
    expect(sessionId).toBeDefined();

    await tmux.resumeClaude("s1", sessionId!);
    expect(tmux.claudeResumes).toEqual([{ sessionName: "s1", sessionId }]);
    expect(tmux.claudeProcesses.get("s1")?.running).toBe(true);
  });

  it("uses default success behavior when no behavior is enqueued", async () => {
    const tmux = new FakeTmux();

    const result = await tmux.execute("s1", {
      taskId: "t1",
      prompt: "auto",
      mode: "oneshot",
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("ok:auto");
    expect(result.sessionId).toBeDefined();
  });

  it("records all failure flags independently", async () => {
    const tmux = new FakeTmux();
    tmux.failCreateSession = true;
    tmux.failKillSession = true;
    tmux.failStartClaude = true;
    tmux.failExitClaude = true;
    tmux.failResumeClaude = true;
    tmux.failAccountSwitch = true;

    await expect(tmux.createSession("s1")).rejects.toThrow("tmux create session failed");
    await expect(tmux.killSession("s1")).rejects.toThrow("tmux kill session failed");
    await expect(tmux.startClaude("s1", {})).rejects.toThrow("claude start failed");
    await expect(tmux.exitClaude("s1")).rejects.toThrow("claude exit failed");
    await expect(tmux.resumeClaude("s1", "id")).rejects.toThrow("claude resume failed");
    await expect(tmux.switchAccount("s1", "b")).rejects.toThrow("account switch failed");
  });
});

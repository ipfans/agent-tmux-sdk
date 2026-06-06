import { describe, expect, it, vi } from "vitest";
import { AgentTmuxSdk, DEFAULT_IDLE_RESTART_MS } from "../src/index.js";
import { FakeTmux } from "./fakes/fake-tmux.js";

describe("idle restart", () => {
  it("defaults to one hour and restarts Claude (not tmux) after the configured threshold", async () => {
    vi.useFakeTimers();
    try {
      const tmux = new FakeTmux();
      const sdk = new AgentTmuxSdk({ tmux, idleRestartMs: 50 });
      expect(DEFAULT_IDLE_RESTART_MS).toBe(60 * 60 * 1000);

      await sdk.runOneShot("first");
      const exitsAfterBootstrap = tmux.claudeExits.length;

      vi.advanceTimersByTime(49);
      await sdk.restartIdleProcesses();
      expect(tmux.claudeExits).toHaveLength(exitsAfterBootstrap);

      vi.advanceTimersByTime(1);
      await sdk.restartIdleProcesses();
      // restart = exitClaude(old) + bootstrapClaude(start → exit → start) = 2 exits
      expect(tmux.claudeExits).toHaveLength(exitsAfterBootstrap + 2);
      expect(tmux.sessions.has("agent-tmux-sdk-1")).toBe(true);
      expect(tmux.sessionKills).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart busy processes even after idle threshold", async () => {
    const tmux = new FakeTmux();
    const sdk = new AgentTmuxSdk({ tmux, idleRestartMs: 0 });

    let resolveExecution!: () => void;
    const gate = new Promise<void>((resolve) => { resolveExecution = resolve; });
    const originalExecute = tmux.execute.bind(tmux);
    tmux.execute = async (session, request) => {
      await gate;
      return originalExecute(session, request);
    };

    const running = sdk.runOneShot("busy");
    await new Promise((r) => setTimeout(r, 5));
    const exitsBeforeCheck = tmux.claudeExits.length;

    await sdk.restartIdleProcesses();
    expect(tmux.claudeExits).toHaveLength(exitsBeforeCheck);

    resolveExecution();
    await running;
  });

  it("uses configurable idleRestartMs from SDK options", async () => {
    vi.useFakeTimers();
    try {
      const tmux = new FakeTmux();
      const sdk = new AgentTmuxSdk({ tmux, idleRestartMs: 200 });

      await sdk.runOneShot("warm");
      const exitsAfterBootstrap = tmux.claudeExits.length;

      vi.advanceTimersByTime(199);
      await sdk.restartIdleProcesses();
      expect(tmux.claudeExits).toHaveLength(exitsAfterBootstrap);

      vi.advanceTimersByTime(1);
      await sdk.restartIdleProcesses();
      expect(tmux.claudeExits).toHaveLength(exitsAfterBootstrap + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});

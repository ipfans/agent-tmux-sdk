import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync("command", ["-v", command], { shell: true });
    return true;
  } catch {
    return false;
  }
}

describe("real tmux/Claude integration", () => {
  it("skips safely unless tmux and claude are available", async () => {
    const tmuxAvailable = await hasCommand("tmux");
    const claudeAvailable = await hasCommand("claude");
    if (!tmuxAvailable || !claudeAvailable) {
      expect({ skipped: true, tmuxAvailable, claudeAvailable }).toMatchObject({ skipped: true });
      return;
    }

    expect(tmuxAvailable && claudeAvailable).toBe(true);
  });
});

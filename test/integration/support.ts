import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync("command", ["-v", command], { shell: true });
    return true;
  } catch {
    return false;
  }
}

async function resolveGate(): Promise<{ enabled: boolean; reason: string }> {
  if (!process.env.RUN_INTEGRATION) {
    return { enabled: false, reason: "set RUN_INTEGRATION=1 (or run `pnpm test:integration`) to enable" };
  }
  const [tmux, claude] = await Promise.all([hasCommand("tmux"), hasCommand("claude")]);
  const missing: string[] = [];
  if (!tmux) missing.push("tmux");
  if (!claude) missing.push("claude");
  if (missing.length > 0) {
    return { enabled: false, reason: `missing command(s): ${missing.join(", ")}` };
  }
  return { enabled: true, reason: "tmux + claude available" };
}

/**
 * Resolved once at module load: whether the real tmux + Claude integration
 * suite should run. Gated by an explicit opt-in (`RUN_INTEGRATION`, set by the
 * `pnpm test:integration` script) AND local availability of both commands.
 * Test files wrap their suites in `describe.skipIf(!integration.enabled)`.
 */
export const integration = await resolveGate();

/**
 * Model the integration suite runs against. Defaults to `haiku` for speed and
 * cost; override with `INTEGRATION_MODEL` (e.g. `INTEGRATION_MODEL=sonnet`).
 */
export const integrationModel = process.env.INTEGRATION_MODEL ?? "haiku";

let counter = 0;

/** A tmux session prefix unique to one test, so concurrent suites never collide. */
export function uniquePrefix(label: string): string {
  counter += 1;
  return `itest-${label}-${process.pid}-${counter}`;
}

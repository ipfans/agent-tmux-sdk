import { TmuxError } from "./errors.js";
import type { ClaudeStartOptions, EnvVars } from "./types.js";

// Session ID (e.g. from "claude --resume <id>") — alphanumeric, underscore, hyphen.
const SESSION_ID_FORMAT = /^[a-zA-Z0-9_-]+$/;
// Model alias (e.g. "haiku"), full name (e.g. "claude-haiku-4-5-20251001"), or a
// name with a bracketed suffix (e.g. "claude-opus-4-8[1m]"). Allows letters,
// digits, and . _ - [ ] only — no whitespace or shell/key-special characters —
// since the result is typed unquoted into the launch command.
const MODEL_FORMAT = /^[a-zA-Z0-9][a-zA-Z0-9._[\]-]*$/;
// POSIX environment variable name: starts with a letter/underscore, then letters,
// digits, underscores. Rejecting anything else blocks name-side shell injection
// and guarantees keys are never array-index-like, so Object.entries iteration is
// always insertion order.
const ENV_NAME_FORMAT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SINGLE_QUOTE = String.fromCharCode(39); // '
const BACKSLASH = String.fromCharCode(92); // \
// Forbid NUL, CR, and LF in values (built from char codes to avoid escapes). A
// CR/LF would be submitted mid-command by tmux `send-keys` — which submits on
// every newline (see tmux-adapter `sendPrompt`) — truncating the launch line and
// leaking the remainder onto a second shell line; a NUL makes Node's execFile
// throw. Every other shell metacharacter is safe because values are single-quoted.
const ENV_VALUE_FORBIDDEN = new RegExp(`[${String.fromCharCode(0, 13, 10)}]`);

/**
 * Wrap a value in POSIX single quotes so the shell treats it literally. The only
 * character that cannot appear inside single quotes is the single quote itself,
 * so each embedded `'` is turned into `'\''` (close quote, escaped quote, reopen).
 */
function singleQuote(value: string): string {
  const escaped = value.split(SINGLE_QUOTE).join(SINGLE_QUOTE + BACKSLASH + SINGLE_QUOTE + SINGLE_QUOTE);
  return SINGLE_QUOTE + escaped + SINGLE_QUOTE;
}

/**
 * Format env vars as a POSIX command prefix — `K1='v1' K2='v2' ` (with a trailing
 * space) — scoped to the next command only, never `export`ed. Returns "" when
 * there is nothing to set. Insertion order is preserved.
 *
 * @throws {TmuxError} if a name is not a valid POSIX identifier, or a value
 *   contains a newline, carriage return, or NUL byte.
 */
export function formatEnvAssignments(env: EnvVars | undefined): string {
  if (env === undefined) {
    return "";
  }
  const parts: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!ENV_NAME_FORMAT.test(name)) {
      throw new TmuxError(`Invalid environment variable name: ${name}`);
    }
    if (ENV_VALUE_FORBIDDEN.test(value)) {
      throw new TmuxError(
        `Environment variable ${name} contains a forbidden character (newline or NUL)`,
      );
    }
    parts.push(`${name}=${singleQuote(value)}`);
  }
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

/**
 * Build the shell command that launches Claude in a tmux pane:
 * `K='v' … claude --resume <id> --model <m> --dangerously-skip-permissions`.
 * Env assignments come first (scoped to the `claude` process), followed by the
 * `claude` invocation and its flags.
 *
 * @throws {TmuxError} on an invalid session ID, model format, or env entry.
 */
export function buildClaudeCommand(options: ClaudeStartOptions): string {
  const parts = ["claude"];
  if (options.sessionId) {
    if (!SESSION_ID_FORMAT.test(options.sessionId)) {
      throw new TmuxError(`Invalid Claude session ID format: ${options.sessionId}`);
    }
    parts.push("--resume", options.sessionId);
  }
  if (options.model) {
    if (!MODEL_FORMAT.test(options.model)) {
      throw new TmuxError(`Invalid Claude model format: ${options.model}`);
    }
    parts.push("--model", options.model);
  }
  if (options.dangerouslySkipPermissions === true) {
    parts.push("--dangerously-skip-permissions");
  }
  return `${formatEnvAssignments(options.env)}${parts.join(" ")}`;
}

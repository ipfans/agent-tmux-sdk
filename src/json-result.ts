/**
 * Pure helpers for result-mode JSON handling: building the single-line
 * JSON-only prompt instructions and extracting a JSON value from noisy tmux
 * pane output.
 *
 * Zero dependencies by design — no `zod` import here. Validation and parsing
 * are owned by the SDK orchestration; this module only shapes prompts and
 * recovers a candidate JSON string from terminal noise.
 */

// CSI escape sequences (defensive — `tmux capture-pane -p` is normally plain
// text, but `-e` or a non-default config can leave colour codes in the buffer).
// Built with an explicit ESC (0x1b) so the pattern never strips a literal
// bracket such as a JSON array `[1]`.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/**
 * Build the single-line instruction appended to result-mode prompts. Must stay
 * one line — `tmux send-keys` submits on every newline, so an embedded newline
 * would send a fragment.
 */
export function buildResultInstruction(shape?: string): string {
  const base =
    "Respond with ONLY a single JSON object or array and nothing else — no markdown code fences, no commentary, no surrounding text.";
  if (shape !== undefined && shape.trim().length > 0) {
    return `${base} The JSON must conform to this shape: ${collapseWhitespace(shape)}.`;
  }
  return base;
}

/**
 * Build the single-line re-prompt used when a result reply failed to parse or
 * validate. `error`, when supplied, is folded in on one line so the next
 * attempt is corrective rather than blind.
 */
export function buildRepairInstruction(error?: string): string {
  const reason =
    error !== undefined && error.trim().length > 0
      ? ` It failed with: ${collapseWhitespace(error)}.`
      : "";
  return `Your previous reply was not usable as JSON.${reason} Reply with ONLY a single JSON object or array — no code fences, no explanation, no surrounding text.`;
}

const MAX_ERROR_LENGTH = 300;

/**
 * Render a validator's error into a short single-line string for a repair
 * re-prompt. Handles the common `{ issues: [{ path, message }] }` shape (Zod
 * and Standard-Schema style) and falls back to `.message` / string form, so a
 * validator version change cannot break repair formatting or throw.
 */
export function formatSchemaError(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const issues = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      const parts = issues
        .map((issue) => {
          if (issue !== null && typeof issue === "object") {
            const rawPath = (issue as { path?: unknown }).path;
            const path = Array.isArray(rawPath) ? rawPath.join(".") : "";
            const rawMessage = (issue as { message?: unknown }).message;
            const message = typeof rawMessage === "string" ? rawMessage : "invalid";
            return path.length > 0 ? `${path}: ${message}` : message;
          }
          return String(issue);
        })
        .filter((part) => part.length > 0);
      if (parts.length > 0) {
        return truncate(parts.join("; "));
      }
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return truncate(message);
    }
  }
  if (typeof error === "string" && error.length > 0) {
    return truncate(error);
  }
  return "schema validation failed";
}

function truncate(input: string): string {
  const collapsed = collapseWhitespace(input);
  return collapsed.length > MAX_ERROR_LENGTH ? `${collapsed.slice(0, MAX_ERROR_LENGTH - 1)}…` : collapsed;
}

/**
 * Extract a JSON value from noisy terminal output. Strips ANSI noise, then
 * scans for balanced object/array regions (respecting quoted strings, so braces
 * inside strings do not break balancing) and returns the LAST one that parses.
 *
 * "Last" is deliberate: a result-mode capture may contain a prior task's JSON
 * (reused tmux slot) or a shape example echoed in the prompt before the actual
 * answer — the answer is the last valid value. Fenced ```json blocks need no
 * special handling; the balanced scan finds the value inside them too.
 *
 * Returns undefined when no parseable JSON value is present.
 */
export function extractJson(raw: string): string | undefined {
  const cleaned = stripAnsi(raw);
  const candidates = balancedJsonCandidates(cleaned);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (candidate !== undefined && isParseable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function isParseable(candidate: string): boolean {
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect every top-level balanced `{...}` / `[...]` region, in document order.
 * Nested brackets are consumed as part of their enclosing region; brackets
 * inside JSON strings are ignored.
 */
function balancedJsonCandidates(input: string): string[] {
  const candidates: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "{" || ch === "[") {
      const end = matchBalanced(input, i);
      if (end !== -1) {
        candidates.push(input.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return candidates;
}

/** Return the index of the bracket that closes the one opened at `start`, or -1. */
function matchBalanced(input: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

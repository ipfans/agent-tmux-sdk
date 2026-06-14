import { describe, expect, it } from "vitest";
import { buildClaudeCommand, deepseek, formatEnvAssignments, TmuxError } from "../src/index.js";

// Control/quote characters built from char codes so the test source stays plain
// ASCII (no literal backslashes or control bytes to be mangled on the way to disk).
const Q = String.fromCharCode(39); // '
const BS = String.fromCharCode(92); // \
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);

describe("formatEnvAssignments", () => {
  it("returns an empty string for undefined", () => {
    expect(formatEnvAssignments(undefined)).toBe("");
  });

  it("returns an empty string for an empty map", () => {
    expect(formatEnvAssignments({})).toBe("");
  });

  it("formats a single var with a trailing space", () => {
    expect(
      formatEnvAssignments({ ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic" }),
    ).toBe("ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic' ");
  });

  it("preserves insertion order", () => {
    expect(formatEnvAssignments({ B: "1", A: "2" })).toBe("B='1' A='2' ");
  });

  it("single-quotes a bracketed model value without escaping", () => {
    expect(formatEnvAssignments({ ANTHROPIC_MODEL: "deepseek-v4-pro[1m]" })).toBe(
      "ANTHROPIC_MODEL='deepseek-v4-pro[1m]' ",
    );
  });

  it("leaves shell metacharacters literal inside single quotes", () => {
    expect(formatEnvAssignments({ X: "a$b|c;d*e&f`g" })).toBe("X='a$b|c;d*e&f`g' ");
  });

  it("escapes an embedded single quote the POSIX way", () => {
    // value a'b  ->  'a'\''b'
    expect(formatEnvAssignments({ X: "a" + Q + "b" })).toBe(`X=${Q}a${Q}${BS}${Q}${Q}b${Q} `);
  });

  it("allows spaces in values", () => {
    expect(formatEnvAssignments({ X: "hello world" })).toBe("X='hello world' ");
  });

  it("formats an empty-string value as two single quotes", () => {
    expect(formatEnvAssignments({ X: "" })).toBe(`X=${Q}${Q} `);
  });

  it("rejects names that are not POSIX identifiers", () => {
    expect(() => formatEnvAssignments({ "FOO BAR": "x" })).toThrow(TmuxError);
    expect(() => formatEnvAssignments({ "1ABC": "x" })).toThrow(/Invalid environment variable name/);
    expect(() => formatEnvAssignments({ "FOO-BAR": "x" })).toThrow(TmuxError);
    expect(() => formatEnvAssignments({ "FOO=BAR": "x" })).toThrow(TmuxError);
  });

  it("rejects values containing a newline, carriage return, or NUL", () => {
    expect(() => formatEnvAssignments({ X: "a" + LF + "b" })).toThrow(/forbidden character/);
    expect(() => formatEnvAssignments({ X: "a" + CR + "b" })).toThrow(TmuxError);
    expect(() => formatEnvAssignments({ X: "a" + NUL + "b" })).toThrow(TmuxError);
  });
});

describe("buildClaudeCommand", () => {
  it("builds a bare claude command with no options", () => {
    expect(buildClaudeCommand({})).toBe("claude");
  });

  it("adds --resume for a valid session id", () => {
    expect(buildClaudeCommand({ sessionId: "abc-123_XYZ" })).toBe("claude --resume abc-123_XYZ");
  });

  it("rejects an invalid session id", () => {
    expect(() => buildClaudeCommand({ sessionId: "bad id; rm" })).toThrow(/Invalid Claude session ID/);
  });

  it("adds --model for a valid model", () => {
    expect(buildClaudeCommand({ model: "haiku" })).toBe("claude --model haiku");
  });

  it("rejects an invalid model format", () => {
    expect(() => buildClaudeCommand({ model: "bad model; rm -rf" })).toThrow(
      /Invalid Claude model format/,
    );
  });

  it("accepts a bracketed model name", () => {
    expect(buildClaudeCommand({ model: "claude-opus-4-8[1m]" })).toBe(
      "claude --model claude-opus-4-8[1m]",
    );
  });

  it("adds the skip-permissions flag only when true", () => {
    expect(buildClaudeCommand({ dangerouslySkipPermissions: true })).toBe(
      "claude --dangerously-skip-permissions",
    );
    expect(buildClaudeCommand({ dangerouslySkipPermissions: false })).toBe("claude");
  });

  it("prepends env assignments before claude with flags in order", () => {
    const cmd = buildClaudeCommand({
      env: { ANTHROPIC_BASE_URL: "https://x/anthropic", ANTHROPIC_AUTH_TOKEN: "sk-1" },
      sessionId: "sess-1",
      model: "haiku",
      dangerouslySkipPermissions: true,
    });
    expect(cmd).toBe(
      "ANTHROPIC_BASE_URL='https://x/anthropic' ANTHROPIC_AUTH_TOKEN='sk-1' " +
        "claude --resume sess-1 --model haiku --dangerously-skip-permissions",
    );
  });

  it("produces the expected launch line for a deepseek() env map", () => {
    const cmd = buildClaudeCommand({
      env: deepseek({ apiKey: "sk-deepseek" }),
      sessionId: "s1",
      dangerouslySkipPermissions: true,
    });
    expect(cmd).toBe(
      "ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic' " +
        "ANTHROPIC_AUTH_TOKEN='sk-deepseek' " +
        "ANTHROPIC_MODEL='deepseek-v4-pro[1m]' " +
        "ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4-pro[1m]' " +
        "ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4-pro[1m]' " +
        "ANTHROPIC_DEFAULT_HAIKU_MODEL='deepseek-v4-flash' " +
        "CLAUDE_CODE_SUBAGENT_MODEL='deepseek-v4-flash' " +
        "CLAUDE_CODE_EFFORT_LEVEL='max' " +
        "claude --resume s1 --dangerously-skip-permissions",
    );
  });
});

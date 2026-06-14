import { describe, expect, it } from "vitest";
import {
  buildRepairInstruction,
  buildResultInstruction,
  extractJson,
  formatSchemaError,
} from "../src/json-result.js";

const ESC = String.fromCharCode(27);

describe("extractJson", () => {
  it("extracts a clean JSON object", () => {
    const out = extractJson('{"value":3}');
    expect(out).toBeDefined();
    expect(JSON.parse(out!)).toEqual({ value: 3 });
  });

  it("extracts JSON wrapped in a fenced code block amid prose", () => {
    const raw = "Here is your result:\n```json\n{\"ok\":true}\n```\nDone.";
    expect(JSON.parse(extractJson(raw)!)).toEqual({ ok: true });
  });

  it("extracts JSON from a noisy captured pane with TUI chrome and status lines", () => {
    const raw = [
      "user> summarize this",
      "",
      '{"files": 3, "summary": "ok"}',
      "",
      "✻ Baked (12s · 1.2k tokens)",
      "❯ ",
    ].join("\n");
    expect(JSON.parse(extractJson(raw)!)).toEqual({ files: 3, summary: "ok" });
  });

  it("strips ANSI escape codes before extracting", () => {
    const colored = `${ESC}[32m{"colored":true}${ESC}[0m`;
    expect(JSON.parse(extractJson(colored)!)).toEqual({ colored: true });
  });

  it("returns only the object when a trailing log line follows", () => {
    const raw = '{"a":1}\n[INFO] task complete';
    expect(JSON.parse(extractJson(raw)!)).toEqual({ a: 1 });
  });

  it("does not break on braces inside strings", () => {
    const raw = '{"msg":"a } b { c","n":2}';
    expect(JSON.parse(extractJson(raw)!)).toEqual({ msg: "a } b { c", n: 2 });
  });

  it("extracts a top-level array", () => {
    expect(JSON.parse(extractJson("result: [1, 2, 3]")!)).toEqual([1, 2, 3]);
  });

  it("returns undefined when no JSON value is present", () => {
    expect(extractJson("just some prose, no json here")).toBeUndefined();
  });

  it("returns the last balanced value when several are present", () => {
    expect(JSON.parse(extractJson('{"a":1} then {"b":2}')!)).toEqual({ b: 2 });
  });

  it("recovers JSON embedded in bracket-balanced prose", () => {
    expect(JSON.parse(extractJson("Here's the result: [the object {\"a\":1}]")!)).toEqual({ a: 1 });
  });

  it("does not break on escaped quotes inside string values", () => {
    const raw = '{"k":"a\\"b","n":1}';
    expect(JSON.parse(extractJson(raw)!)).toEqual({ k: 'a"b', n: 1 });
  });

  it("returns undefined for an unclosed/unbalanced bracket", () => {
    expect(extractJson("{ unclosed json")).toBeUndefined();
  });

  it("returns undefined for a bare scalar (result mode targets objects and arrays)", () => {
    expect(extractJson("42")).toBeUndefined();
    expect(extractJson('"hello"')).toBeUndefined();
    expect(extractJson("true")).toBeUndefined();
  });

  it("returns the current answer past stale scrollback and an echoed shape example", () => {
    const capture = [
      '{"task":"previous"}', // stale prior-task JSON left in a reused slot
      'user> reply with JSON shaped like {"example": 0}', // prompt echo with a shape example
      '{"sum":4}', // the actual answer
      "❯ ",
    ].join("\n");
    expect(JSON.parse(extractJson(capture)!)).toEqual({ sum: 4 });
  });
});

describe("buildResultInstruction", () => {
  it("returns a non-empty single-line JSON-only directive", () => {
    const instruction = buildResultInstruction();
    expect(instruction.length).toBeGreaterThan(0);
    expect(instruction).not.toContain("\n");
  });

  it("includes a shape hint on one line when provided", () => {
    const instruction = buildResultInstruction("{ sum: number }");
    expect(instruction).toContain("sum: number");
    expect(instruction).not.toContain("\n");
  });
});

describe("buildRepairInstruction", () => {
  it("is single-line and folds in the error when provided", () => {
    const instruction = buildRepairInstruction("expected number, got string");
    expect(instruction).toContain("expected number, got string");
    expect(instruction).not.toContain("\n");
  });

  it("is single-line without an error", () => {
    expect(buildRepairInstruction()).not.toContain("\n");
  });
});

describe("formatSchemaError", () => {
  it("renders issues with path and message on a single line", () => {
    const error = { issues: [{ path: ["sum"], message: "Expected number, received string" }] };
    const formatted = formatSchemaError(error);
    expect(formatted).toBe("sum: Expected number, received string");
    expect(formatted).not.toContain("\n");
  });

  it("joins multiple issues", () => {
    const error = {
      issues: [
        { path: ["a"], message: "required" },
        { path: ["b", "c"], message: "too small" },
      ],
    };
    expect(formatSchemaError(error)).toBe("a: required; b.c: too small");
  });

  it("coerces a non-object issue element to a string", () => {
    expect(formatSchemaError({ issues: ["missing field"] })).toBe("missing field");
  });

  it("falls back to message, then string, then a default", () => {
    expect(formatSchemaError({ message: "bad" })).toBe("bad");
    expect(formatSchemaError("plain error")).toBe("plain error");
    expect(formatSchemaError(undefined)).toBe("schema validation failed");
  });
});

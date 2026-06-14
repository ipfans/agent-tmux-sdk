/**
 * Result mode — get validated, typed JSON from Claude.
 *
 * 结果模式 — 从 Claude 获取经校验、带类型的 JSON。
 *
 * The SDK internally coaxes JSON-only output, extracts it from the terminal,
 * and retries on failure. Pass an optional Zod schema (an optional peer
 * dependency) to validate the shape and type the result — describe the fields
 * you want in the prompt; the SDK handles the JSON formatting.
 */
import { z } from "zod";
import { AgentTmuxSdk, ResultParseError } from "agent-tmux-sdk";

const CodeReview = z.object({
  files: z.array(z.string()),
  issues: z.array(
    z.object({
      file: z.string(),
      line: z.number(),
      severity: z.string(),
      message: z.string(),
    }),
  ),
  summary: z.string(),
});

async function main() {
  const sdk = new AgentTmuxSdk();

  try {
    const result = await sdk.runTask({
      prompt:
        "Review src/ and report the files reviewed, any issues (file, line, severity, message), and a short summary.",
      mode: "result",
      schema: CodeReview,
      workingDirectory: "/path/to/project",
    });

    // result.result is typed from the schema — no casts needed.
    console.log("Reviewed files:", result.result?.files);
    console.log("Issues found:", result.result?.issues.length);
    console.log("Summary:", result.result?.summary);
    console.log("Resumed after token exhaustion:", result.resumed);
  } catch (error) {
    if (error instanceof ResultParseError) {
      console.error("Claude could not produce valid JSON after retries:", error.message);
    }
    throw error;
  } finally {
    await sdk.cleanup();
  }
}

main().catch(console.error);

/**
 * Result mode — get structured JSON output from Claude.
 *
 * 结果模式 — 从 Claude 获取结构化 JSON 输出。
 */
import { AgentTmuxSdk, ResultParseError } from "agent-tmux-sdk";

interface CodeReview {
  files: string[];
  issues: Array<{ file: string; line: number; severity: string; message: string }>;
  summary: string;
}

async function main() {
  const sdk = new AgentTmuxSdk();

  try {
    const result = await sdk.runTask<CodeReview>({
      prompt: "Review src/ and return a JSON object with fields: files (string[]), issues (array of {file, line, severity, message}), summary (string)",
      mode: "result",
      workingDirectory: "/path/to/project",
    });

    console.log("Reviewed files:", result.result?.files);
    console.log("Issues found:", result.result?.issues.length);
    console.log("Summary:", result.result?.summary);
    console.log("Resumed after token exhaustion:", result.resumed);
  } catch (error) {
    if (error instanceof ResultParseError) {
      console.error("Claude output was not valid JSON:", error.message);
    }
    throw error;
  } finally {
    await sdk.cleanup();
  }
}

main().catch(console.error);

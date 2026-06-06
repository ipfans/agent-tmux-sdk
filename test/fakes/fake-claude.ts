import type { ClaudeExecutionRequest, ClaudeExecutionResult } from "../../src/index.js";

export type FakeClaudeBehavior =
  | { type: "success"; output: string; result?: unknown; delayMs?: number }
  | { type: "token-exhausted"; output?: string; resumeWith: FakeClaudeBehavior; delayMs?: number }
  | { type: "failure"; message: string; output?: string; delayMs?: number };

export class FakeClaude {
  readonly executions: ClaudeExecutionRequest[] = [];
  readonly resumes: ClaudeExecutionRequest[] = [];
  private behaviors: FakeClaudeBehavior[] = [];
  private nextSessionId = 1;

  enqueue(behavior: FakeClaudeBehavior): void {
    this.behaviors.push(behavior);
  }

  async execute(request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult> {
    this.executions.push(request);
    const behavior = this.behaviors.shift() ?? {
      type: "success",
      output: `ok:${request.prompt}`,
    };
    return this.resolveBehavior(behavior);
  }

  async resume(request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult> {
    this.resumes.push(request);
    return this.execute(request);
  }

  private async resolveBehavior(
    behavior: FakeClaudeBehavior,
  ): Promise<ClaudeExecutionResult> {
    if (behavior.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
    }

    if (behavior.type === "token-exhausted") {
      this.behaviors.unshift(behavior.resumeWith);
      return {
        exitCode: 42,
        output: behavior.output ?? "token exhausted",
        tokenExhausted: true,
        sessionId: `claude-session-${this.nextSessionId++}`,
      };
    }

    if (behavior.type === "failure") {
      return {
        exitCode: 1,
        output: behavior.output ?? behavior.message,
        error: behavior.message,
      };
    }

    return {
      exitCode: 0,
      output: behavior.output,
      result: behavior.result,
      sessionId: `claude-session-${this.nextSessionId++}`,
    };
  }
}

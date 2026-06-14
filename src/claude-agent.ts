import { AgentTmuxSdk } from "./sdk.js";
import type { ClaudeAgentOptions } from "./types.js";

export class ClaudeAgent {
  private readonly sdk: AgentTmuxSdk;
  private readonly workingDirectory?: string;
  private readonly timeoutMs?: number;
  private cleaned = false;

  constructor(options: ClaudeAgentOptions = {}) {
    this.workingDirectory = options.workingDirectory;
    this.timeoutMs = options.timeoutMs;
    this.sdk = new AgentTmuxSdk({
      poolSize: 1,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? true,
      model: options.model,
    });
  }

  async run(prompt: string): Promise<string> {
    const result = await this.sdk.runOneShot(prompt, {
      workingDirectory: this.workingDirectory,
      timeoutMs: this.timeoutMs,
    });
    return result.output;
  }

  async *stream(prompt: string): AsyncIterable<string> {
    yield* this.sdk.runStream(prompt, {
      workingDirectory: this.workingDirectory,
      timeoutMs: this.timeoutMs,
    });
  }

  async cleanup(): Promise<void> {
    if (this.cleaned) return;
    this.cleaned = true;
    await this.sdk.cleanup();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.cleanup();
  }
}

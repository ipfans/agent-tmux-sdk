import { AgentTmuxSdk } from "./sdk.js";
import type { TaskResult } from "./types.js";

export class ClaudeAgent {
  constructor(private readonly sdk: AgentTmuxSdk = new AgentTmuxSdk()) {}

  run(prompt: string): Promise<TaskResult> {
    return this.sdk.runOneShot(prompt);
  }
}

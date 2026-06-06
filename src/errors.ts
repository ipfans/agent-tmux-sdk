export class AgentTmuxSdkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class TmuxError extends AgentTmuxSdkError {}
export class AgentTaskError extends AgentTmuxSdkError {}
export class TaskTimeoutError extends AgentTaskError {}
export class ResultParseError extends AgentTaskError {}

export const DEFAULT_IDLE_RESTART_MS = 60 * 60 * 1000;

export type ProcessState = "idle" | "starting" | "busy" | "restarting" | "stopped" | "failed";
export type TaskState = "queued" | "running" | "resuming" | "succeeded" | "failed" | "cancelled";
export type TaskMode = "oneshot" | "result";
export type ClaudeSessionId = string;

export interface ClaudeAgentOptions {
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
  readonly dangerouslySkipPermissions?: boolean;
}

export interface AgentTmuxSdkOptions {
  readonly poolSize?: number;
  readonly idleRestartMs?: number;
  readonly startupTimeoutMs?: number;
  readonly taskTimeoutMs?: number;
  readonly resumeAttempts?: number;
  readonly sessionPrefix?: string;
  readonly waitForResult?: boolean;
  readonly dangerouslySkipPermissions?: boolean;
  readonly tmux?: TmuxAdapter;
}

export interface RunTaskOptions {
  readonly taskId?: string;
  readonly prompt: string;
  readonly mode?: TaskMode;
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
  readonly waitForResult?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface RunStreamOptions {
  readonly taskId?: string;
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface RunOneShotOptions {
  readonly taskId?: string;
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
  readonly waitForResult?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface TaskResult<TResult = unknown> {
  readonly taskId: string;
  readonly state: "succeeded";
  readonly output: string;
  readonly result?: TResult;
  readonly processId: string;
  readonly mode: TaskMode;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly resumed: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface TaskSnapshot {
  readonly taskId: string;
  readonly state: TaskState;
  readonly mode: TaskMode;
  readonly prompt: string;
  readonly processId?: string;
  readonly output?: string;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ProcessSnapshot {
  readonly id: string;
  readonly sessionName: string;
  readonly paneId?: string;
  readonly state: ProcessState;
  readonly startedAt: number;
  readonly lastUsedAt: number;
  readonly currentTaskId?: string;
  readonly claudeSessionId?: ClaudeSessionId;
  readonly claudeRunning: boolean;
}

export interface TmuxProcessHandle {
  readonly sessionName: string;
  readonly paneId?: string;
  readonly startedAt: number;
}

export interface ClaudeStartOptions {
  readonly startupTimeoutMs?: number;
  readonly sessionId?: ClaudeSessionId;
  readonly dangerouslySkipPermissions?: boolean;
}

export interface ClaudeExecutionRequest {
  readonly taskId: string;
  readonly prompt: string;
  readonly mode: TaskMode;
  readonly workingDirectory?: string;
  readonly waitForResult?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface ClaudeExecutionResult {
  readonly exitCode: number;
  readonly output: string;
  readonly result?: unknown;
  readonly tokenExhausted?: boolean;
  readonly error?: string;
  readonly sessionId?: ClaudeSessionId;
}

export interface RealTmuxAdapterOptions {
  readonly pollIntervalMs?: number;
  readonly stableThresholdMs?: number;
  readonly readyPattern?: RegExp;
}

export interface TmuxAdapter {
  createSession(sessionName: string, workingDirectory?: string): Promise<TmuxProcessHandle>;
  killSession(sessionName: string): Promise<void>;
  capturePane(sessionName: string): Promise<string>;
  startClaude(sessionName: string, options: ClaudeStartOptions): Promise<void>;
  exitClaude(sessionName: string): Promise<ClaudeSessionId | undefined>;
  resumeClaude(sessionName: string, sessionId: ClaudeSessionId): Promise<void>;
  execute(sessionName: string, request: ClaudeExecutionRequest): Promise<ClaudeExecutionResult>;
  stream(sessionName: string, request: ClaudeExecutionRequest): AsyncIterable<string>;
}

export type SdkEventMap = {
  taskQueued: [snapshot: TaskSnapshot];
  taskStarted: [snapshot: TaskSnapshot];
  taskCompleted: [result: TaskResult];
  taskFailed: [taskId: string, error: Error];
  taskResuming: [taskId: string, attempt: number];
  processStarted: [processId: string];
  processStopped: [processId: string];
  processError: [processId: string, error: Error];
  streamChunk: [taskId: string, chunk: string];
};

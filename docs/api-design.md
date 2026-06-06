# agent-tmux-sdk API design

`agent-tmux-sdk` manages a pool of Claude CLI processes running inside long-lived tmux sessions. The core model: **tmux session = container (long-lived)**, **Claude process = consumer (short-lived within tmux)**. The SDK owns the tmux container lifecycle, Claude consumer lifecycle, task assignment, idle restarts, account switching, token-exhaustion recovery, and two-phase cleanup.

## Public entry point

```ts
import { AgentTmuxSdk } from "agent-tmux-sdk";

const sdk = new AgentTmuxSdk({
  poolSize: 2,
  idleRestartMs: 60 * 60 * 1000,
  account: "work",
});

const result = await sdk.runTask({
  prompt: "Summarize this repository",
  mode: "result",
});

await sdk.cleanup();
```

## Configuration

All numeric values are configurable through `AgentTmuxSdkOptions`.

| Option | Default | Purpose |
| --- | --- | --- |
| `poolSize` | `1` | Maximum number of tmux containers (and their Claude consumers) kept by the pool. |
| `idleRestartMs` | `3_600_000` | Idle Claude consumer age before restart. Configurable for tests and production tuning. |
| `startupTimeoutMs` | `30_000` | Maximum time to wait for a Claude consumer to become ready inside its tmux container. |
| `taskTimeoutMs` | `0` | Per-task timeout. `0` disables timeout. |
| `resumeAttempts` | `1` | Attempts to shield callers from token-exhaustion exits by resuming the Claude session. Set to `0` to disable. |
| `account` | `undefined` | Initial Claude account/profile label passed to consumer startup. |
| `sessionPrefix` | `"agent-tmux-sdk"` | Prefix for tmux session names. Allows multiple SDK instances to coexist. |
| `waitForResult` | `true` | Whether to wait for Claude output to stabilize before returning. Per-task overridable. |
| `tmux` | real adapter | Adapter boundary used by fake and real tmux implementations. |

## Core types

```ts
type ProcessState = "idle" | "starting" | "busy" | "restarting" | "stopped" | "failed";
type TaskState = "queued" | "running" | "resuming" | "succeeded" | "failed" | "cancelled";
type TaskMode = "oneshot" | "result";
type ClaudeSessionId = string;
```

`ClaudeSessionId` tracks the Claude CLI session identifier, used for `claude --resume <id>` during token-exhaustion recovery.

## Key types

```ts
interface ClaudeStartOptions {
  readonly account?: string;
  readonly startupTimeoutMs?: number;
}

interface ClaudeExecutionRequest {
  readonly taskId: string;
  readonly prompt: string;
  readonly mode: TaskMode;
  readonly workingDirectory?: string;
  readonly account?: string;
  readonly waitForResult?: boolean;
  readonly metadata?: Record<string, unknown>;
}

interface ClaudeExecutionResult {
  readonly exitCode: number;
  readonly output: string;
  readonly result?: unknown;
  readonly tokenExhausted?: boolean;
  readonly error?: string;
  readonly sessionId?: ClaudeSessionId;
}

interface ProcessSnapshot {
  readonly id: string;
  readonly sessionName: string;
  readonly paneId?: string;
  readonly state: ProcessState;
  readonly account?: string;
  readonly startedAt: number;
  readonly lastUsedAt: number;
  readonly currentTaskId?: string;
  readonly claudeSessionId?: ClaudeSessionId;
  readonly claudeRunning: boolean;
}
```

`ProcessSnapshot` exposes `claudeSessionId` (the last known Claude session identifier) and `claudeRunning` (whether a Claude consumer is currently active inside the tmux container).

## Task execution

- `runOneShot(prompt, options?)` — fire-and-forget CLI usage. Returns `TaskResult` with output text.
- `runTask<TResult>(options)` — returns a `TaskResult<TResult>` with `taskId`, `state`, `output`, optional parsed `result`, lifecycle metadata (`startedAt`, `completedAt`, `resumed`), and caller-provided `metadata`.

Both methods accept `waitForResult` to override the global default. When `true` (the default), the adapter polls `capture-pane` until output stabilizes. When `false`, it returns immediately after sending keys.

Both methods queue tasks when the pool is saturated and drain in assignment order.

## Container/consumer lifecycle

- **Container creation**: tmux sessions are created lazily when tasks arrive and idle slots are available. A new slot creates a tmux session (container) then starts a Claude process (consumer) inside it.
- **Consumer reuse**: idle Claude consumers are reused for subsequent tasks without restarting.
- **Idle restart**: `restartIdleProcesses(now?)` exits the Claude consumer (`exitClaude`) and starts a fresh one (`startClaude`) within the same tmux container. The tmux session is never killed during idle restart. Busy processes are never restarted.
- **Account switching**: `switchAccount(account)` switches idle processes immediately and defers the switch for busy processes until their next idle transition. Same-account switches are no-ops.
- **Cleanup**: two-phase teardown. First, `exitClaude` gracefully exits each Claude consumer. Then, `killSession` destroys the tmux container. It is idempotent. New tasks are rejected after cleanup.

## Token-exhaustion recovery

When Claude exits due to token exhaustion, the SDK:

1. Captures the Claude session ID from the exit output.
2. Calls `exitClaude` to gracefully leave the Claude process and capture the `ClaudeSessionId`.
3. Calls `resumeClaude(sessionName, sessionId)` which runs `claude --resume <id>` inside the same tmux container.
4. Sends a "continue" prompt to the resumed session.

This cycle repeats up to `resumeAttempts` times. If all attempts fail, the error is surfaced to the caller. Successful resumes are transparent — the `TaskResult.resumed` flag indicates whether resume occurred. The `ClaudeExecutionResult.sessionId` field carries the session identifier through each execution.

## Error hierarchy

```
AgentTmuxSdkError (base)
├── TmuxError          — tmux container/Claude consumer start, restart, account switch, cleanup failures
└── AgentTaskError     — task-level failures
    ├── TaskTimeoutError   — per-task timeout exceeded
    └── ResultParseError   — result-mode output was not valid JSON
```

## Tmux adapter boundary

The SDK talks to tmux through a small `TmuxAdapter` interface that separates container operations from consumer operations:

**Container operations** (tmux session lifecycle):
- `createSession(sessionName, workingDirectory?)` — creates a long-lived tmux session (container).
- `killSession(sessionName)` — destroys the tmux session (container).
- `capturePane(sessionName)` — captures current pane output from the container.

**Consumer operations** (Claude process lifecycle within a container):
- `startClaude(sessionName, options)` — starts a Claude consumer inside an existing tmux container.
- `exitClaude(sessionName)` — gracefully exits the Claude consumer, returns the `ClaudeSessionId` if available.
- `resumeClaude(sessionName, sessionId)` — resumes a Claude consumer with `claude --resume <id>`.

**Task operations**:
- `execute(sessionName, request)` — sends work to the Claude consumer and waits for completion.
- `switchAccount(sessionName, account)` — switches account/profile for the Claude consumer.

The `RealTmuxAdapter` accepts `RealTmuxAdapterOptions` to configure polling and readiness detection:

| Option | Default | Purpose |
| --- | --- | --- |
| `pollIntervalMs` | `500` | Interval between `capture-pane` polls. |
| `stableThresholdMs` | `5000` | Duration output must be unchanged before considered stable. |
| `readyPattern` | `/✻ (Baked\|Took\|Done\|Cogitated)/` | Regex pattern to detect Claude readiness after a response completes. |

Tests use deterministic fake tmux and fake Claude harnesses. Real tmux/Claude integration tests are optional and skip when local commands are unavailable.

## Convenience wrapper

```ts
import { ClaudeAgent } from "agent-tmux-sdk";

const agent = new ClaudeAgent(new AgentTmuxSdk({ tmux }));
const result = await agent.run("Hello");
```

## Scenario matrix

See [scenario-matrix.md](scenario-matrix.md) for the full test contract surface with 50 tests across 14 files.

> 中文版本：[api-design_zh.md](api-design_zh.md)

# agent-tmux-sdk

TypeScript SDK for orchestrating tmux sessions with Claude CLI to build multi-agent workflows. Zero production dependencies by design.

> 中文版本：[README_zh.md](README_zh.md)

## Features

- **Container/consumer model** — tmux sessions are long-lived containers, Claude processes are short-lived consumers within them
- **Process pool** — manages a configurable pool of tmux containers with Claude consumers
- **Task queuing** — queues tasks when the pool is saturated and drains in assignment order
- **Idle restart** — exits the Claude consumer and starts a fresh one in the same tmux container (default: 1 hour)
- **Account switching** — switches Claude accounts on idle processes without interrupting running tasks
- **Token-exhaustion recovery** — captures Claude session ID on exhaustion, resumes with `claude --resume <id>`, sends "continue" prompt
- **Two-phase cleanup** — gracefully exits Claude consumers first, then destroys tmux containers
- **Dual execution modes** — one-shot (fire-and-forget) and result (parsed JSON output)
- **Typed errors** — domain-specific error hierarchy for tmux, task, timeout, and parse failures
- **Testable** — adapter boundary allows deterministic fake tmux/Claude harnesses in tests

## Installation

```bash
pnpm add agent-tmux-sdk
```

## Prerequisites

- Node.js >= 20
- [tmux](https://github.com/tmux/tmux) installed and available in `$PATH`
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Quick start

```typescript
import { AgentTmuxSdk } from "agent-tmux-sdk";

const sdk = new AgentTmuxSdk({
  poolSize: 2,
  idleRestartMs: 60 * 60 * 1000,
  account: "work",
});

// One-shot execution
const oneshot = await sdk.runOneShot("List all files in this directory");
console.log(oneshot.output);

// Result mode — parsed JSON output
const result = await sdk.runTask<{ summary: string }>({
  prompt: "Summarize this repository as JSON",
  mode: "result",
});
console.log(result.result?.summary);

// Clean up (two-phase: exit Claude consumers, then kill tmux containers)
await sdk.cleanup();
```

## Configuration

All numeric values are configurable through `AgentTmuxSdkOptions`.

| Option | Default | Description |
|--------|---------|-------------|
| `poolSize` | `1` | Maximum number of tmux containers in the pool |
| `idleRestartMs` | `3_600_000` | Idle Claude consumer age (ms) before restart |
| `startupTimeoutMs` | `30_000` | Max time (ms) to wait for Claude consumer startup |
| `taskTimeoutMs` | `0` | Per-task timeout (ms). `0` disables |
| `resumeAttempts` | `1` | Token-exhaustion resume attempts. `0` disables |
| `account` | `undefined` | Initial Claude account/profile label |
| `sessionPrefix` | `"agent-tmux-sdk"` | Prefix for tmux session names |
| `waitForResult` | `true` | Wait for Claude output to stabilize before returning. Per-task overridable |
| `tmux` | `RealTmuxAdapter` | Adapter for fake/real tmux implementations |

## API

### `AgentTmuxSdk`

| Method | Description |
|--------|-------------|
| `runOneShot(prompt, options?)` | Fire-and-forget execution, returns `TaskResult` |
| `runTask<T>(options)` | Execute with full options, returns `TaskResult<T>` |
| `getProcesses()` | Snapshot of all pool processes (includes `claudeSessionId`, `claudeRunning`) |
| `getTask(taskId)` | Snapshot of a specific task |
| `switchAccount(account)` | Switch Claude account on idle processes |
| `restartIdleProcesses(now?)` | Exit idle Claude consumer and start fresh one in same tmux container |
| `cleanup()` | Two-phase: exit Claude consumers, then kill tmux containers |

### `TmuxAdapter` interface

Container operations:
- `createSession(sessionName, workingDirectory?)` — create tmux container
- `killSession(sessionName)` — destroy tmux container
- `capturePane(sessionName)` — capture pane output

Consumer operations:
- `startClaude(sessionName, options)` — start Claude consumer in container
- `exitClaude(sessionName)` — exit Claude consumer, returns `ClaudeSessionId`
- `resumeClaude(sessionName, sessionId)` — resume Claude with `claude --resume <id>`

Task operations:
- `execute(sessionName, request)` — send work and wait for completion
- `switchAccount(sessionName, account)` — switch Claude account

### `ClaudeAgent`

Convenience wrapper for simple one-shot usage.

```typescript
import { ClaudeAgent, AgentTmuxSdk } from "agent-tmux-sdk";

const agent = new ClaudeAgent(new AgentTmuxSdk());
const result = await agent.run("Hello");
```

### Error hierarchy

```
AgentTmuxSdkError (base)
├── TmuxError          — tmux container/Claude consumer start, restart, account switch, cleanup
└── AgentTaskError     — task-level failures
    ├── TaskTimeoutError   — per-task timeout exceeded
    └── ResultParseError   — result-mode output was not valid JSON
```

## Testing

The SDK uses a `TmuxAdapter` interface boundary. Tests inject `FakeTmux` and `FakeClaude` harnesses for deterministic, fast unit tests without requiring tmux or Claude CLI.

```bash
pnpm test             # Run tests
pnpm run coverage     # Run with coverage
pnpm test:watch       # Watch mode
```

Integration tests with real tmux/Claude are skip-safe — they run only when both commands are available locally.

## Development

```bash
pnpm run build        # Build ESM + CJS + declarations
pnpm run dev          # Watch mode
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint src/ test/
```

## Architecture

See [docs/api-design.md](docs/api-design.md) for the full API design and [docs/scenario-matrix.md](docs/scenario-matrix.md) for the test contract surface (14 files, 50 tests).

## License

MIT

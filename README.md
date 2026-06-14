# agent-tmux-sdk

TypeScript SDK for orchestrating tmux sessions with Claude CLI to build multi-agent workflows. Zero production dependencies by design.

> 中文版本：[README_zh.md](README_zh.md)

## Features

- **Container/consumer model** — tmux sessions are long-lived containers, Claude processes are short-lived consumers within them
- **Process pool** — manages a configurable pool of tmux containers with Claude consumers
- **Task queuing** — queues tasks when the pool is saturated and drains in assignment order
- **Idle restart** — exits the Claude consumer and starts a fresh one in the same tmux container (default: 1 hour)
- **Streaming** — consume a task's output incrementally with `runStream` (an `AsyncIterable<string>`)
- **Typed lifecycle events** — subscribe to task/process events (`taskStarted`, `streamChunk`, `taskCompleted`, …) via `on`/`off`/`once`
- **Token-exhaustion recovery** — captures Claude session ID on exhaustion, resumes with `claude --resume <id>`, sends "continue" prompt
- **Two-phase cleanup** — gracefully exits Claude consumers first, then destroys tmux containers
- **Dual execution modes** — one-shot (fire-and-forget), and result mode where the SDK coaxes JSON-only output, extracts it from terminal noise, retries on failure, and optionally validates/types it against a Zod schema
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
import { z } from "zod"; // optional peer dependency — only needed for result-mode schemas

const sdk = new AgentTmuxSdk({
  poolSize: 2,
  idleRestartMs: 60 * 60 * 1000,
});

// One-shot execution
const oneshot = await sdk.runOneShot("List all files in this directory");
console.log(oneshot.output);

// Result mode — the SDK gets valid JSON back for you (coax → extract → retry).
// An optional Zod schema validates the shape and types the result.
const review = await sdk.runTask({
  prompt: "Summarize this repository",
  mode: "result",
  schema: z.object({ summary: z.string() }),
});
console.log(review.result?.summary); // typed as string

// Clean up (two-phase: exit Claude consumers, then kill tmux containers)
await sdk.cleanup();
```

> Result-mode schema validation uses [Zod](https://zod.dev) as an **optional peer dependency** — install it only if you pass a `schema`. Without one, result mode still returns parsed JSON and the SDK keeps zero production dependencies. Any validator exposing a compatible `safeParse` works.

## Configuration

All numeric values are configurable through `AgentTmuxSdkOptions`.

| Option | Default | Description |
|--------|---------|-------------|
| `poolSize` | `1` | Maximum number of tmux containers in the pool |
| `idleRestartMs` | `3_600_000` | Idle Claude consumer age (ms) before restart |
| `startupTimeoutMs` | `30_000` | Max time (ms) to wait for Claude consumer startup |
| `taskTimeoutMs` | `0` | Per-task timeout (ms). `0` disables |
| `resumeAttempts` | `1` | Token-exhaustion resume attempts. `0` disables |
| `sessionPrefix` | `"agent-tmux-sdk"` | Prefix for tmux session names |
| `waitForResult` | `true` | Wait for Claude output to stabilize before returning. Per-task overridable |
| `model` | _CLI default_ | Claude model for the whole pool, passed to the CLI as `--model`. Accepts an alias (`haiku`, `sonnet`, `opus`, `fable`) or a full name |
| `env` | _none_ | Environment variables passed to every Claude process as a command prefix — scoped to the process, re-applied on every restart/resume, never `export`ed. Use a preset (`deepseek`/`glm`/`mimo`/`anthropicCompatible`) or a manual map |
| `tmux` | `RealTmuxAdapter` | Adapter for fake/real tmux implementations |

### Third-party models (environment variables)

Point Claude at any Anthropic-compatible provider (DeepSeek, GLM/Zhipu, MiMo/Xiaomi, …) through the `env` option. The variables are applied as a POSIX command prefix on the `claude` launch (`KEY='value' … claude …`) — scoped to that process, re-applied on every restart/resume, and **never** `export`ed into the tmux shell.

```typescript
import { AgentTmuxSdk, ClaudeAgent, deepseek, glm, anthropicCompatible } from "agent-tmux-sdk";

// Preset helper — returns a plain env map
const agent = new ClaudeAgent({ env: deepseek({ apiKey: process.env.DEEPSEEK_API_KEY! }) });

// Compose a preset with manual overrides (later keys win)
const sdk = new AgentTmuxSdk({
  env: { ...glm({ apiKey: process.env.GLM_API_KEY! }), HTTP_PROXY: "http://127.0.0.1:7890" },
});

// Any provider via the generic builder (or a hand-written map)
new AgentTmuxSdk({
  env: anthropicCompatible({ baseUrl: "https://api.example.com/anthropic", apiKey: "…", model: "my-model" }),
});
```

Presets (`deepseek`, `glm`, `mimo`, `anthropicCompatible`) simply return `EnvVars` maps, so they are interchangeable with manual maps. When using a third-party model, let the preset's `ANTHROPIC_MODEL` drive selection rather than the `--model` flag. Note: the launch line (including `ANTHROPIC_AUTH_TOKEN`) is echoed into the local tmux pane's scrollback — acceptable for a local session, and still more private than a shell `export`.

## API

### `AgentTmuxSdk`

| Method | Description |
|--------|-------------|
| `runOneShot(prompt, options?)` | Fire-and-forget execution, returns `TaskResult` |
| `runTask<T>(options)` | Execute with full options, returns `TaskResult<T>` |
| `runStream(prompt, options?)` | Stream output incrementally as an `AsyncIterable<string>` |
| `on(event, listener)` / `off` / `once` | Subscribe to typed lifecycle events (`SdkEventMap`) |
| `getProcesses()` | Snapshot of all pool processes (includes `claudeSessionId`, `claudeRunning`) |
| `getTask(taskId)` | Snapshot of a specific task |
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
- `stream(sessionName, request)` — send work and yield output incrementally
- `interrupt(sessionName)` — stop the current turn, returning Claude to an idle prompt

### `ClaudeAgent`

Beginner-friendly wrapper for a single pooled Claude session. Configured with
`ClaudeAgentOptions` (`workingDirectory`, `timeoutMs`, `dangerouslySkipPermissions`, `model`, `env`).

```typescript
import { ClaudeAgent } from "agent-tmux-sdk";

const agent = new ClaudeAgent({ workingDirectory: "/path/to/project", timeoutMs: 60_000 });
const result = await agent.run("Hello"); // resolves to the output string

for await (const chunk of agent.stream("Tell me a story")) {
  process.stdout.write(chunk);
}

await agent.cleanup(); // also runs via `await using agent = new ClaudeAgent()`
```

### Error hierarchy

```
AgentTmuxSdkError (base)
├── TmuxError          — tmux container/Claude consumer start, restart, completion timeout, cleanup
└── AgentTaskError     — task-level failures
    ├── TaskTimeoutError   — per-task timeout exceeded
    └── ResultParseError   — result-mode output was not valid JSON
```

## Testing

The SDK uses a `TmuxAdapter` interface boundary. Tests inject `FakeTmux` and `FakeClaude` harnesses for deterministic, fast unit tests without requiring tmux or Claude CLI.

```bash
pnpm test              # Fast, fake-only unit tests
pnpm run coverage      # Unit tests with coverage
pnpm test:watch        # Watch mode
pnpm test:integration  # Real tmux + Claude end-to-end (opt-in)
```

`pnpm test` never invokes Claude. The real tmux/Claude end-to-end suite is opt-in: `pnpm test:integration` sets `RUN_INTEGRATION=1`, and is skip-safe — it skips cleanly unless both `tmux` and the Claude CLI are available locally. The integration suite runs against the `haiku` model for speed and cost; override with `INTEGRATION_MODEL` (e.g. `INTEGRATION_MODEL=sonnet pnpm test:integration`).

## Development

```bash
pnpm run build        # Build ESM + CJS + declarations
pnpm run dev          # Watch mode
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint src/ test/
```

## Architecture

See [docs/api-design.md](docs/api-design.md) for the full API design and [docs/scenario-matrix.md](docs/scenario-matrix.md) for the test contract surface.

## License

MIT

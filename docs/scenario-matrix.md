# Scenario matrix

| ID | Status | Test | Failure reason before implementation | Implementation evidence | Verification |
| --- | --- | --- | --- | --- | --- |
| API-01 | Complete | `test/public-api-types.test.ts` | Public API did not exist. | Exported SDK options, states, typed results, typed errors, `ClaudeSessionId`, `ClaudeStartOptions`, container/consumer types. | `pnpm test`, `pnpm run typecheck` |
| HAR-01 | Complete | `test/fake-harness.test.ts` | Fake tmux/fake Claude harnesses did not exist. | Deterministic fake `createSession`, `killSession`, `startClaude`, `exitClaude`, `resumeClaude`, `execute`, `capturePane`, `switchAccount`, failure flags, token-exhaustion resume flow, Claude session ID tracking. | `pnpm test` |
| POOL-01 | Complete | `test/process-pool.test.ts` | Process pool did not exist. | Lazy pool startup with idle reuse, pool size cap, concurrent fill, queue drain, configurable sessionPrefix. | `pnpm test` |
| LIFE-01 | Complete | `test/lifecycle.test.ts` | Lifecycle state tracking did not exist. | Task/process snapshots for success and failure transitions, unknown task returns undefined, metadata propagation, `claudeSessionId` and `claudeRunning` tracking. | `pnpm test` |
| IDLE-01 | Complete | `test/idle-restart.test.ts` | Idle restart logic did not exist. | `DEFAULT_IDLE_RESTART_MS` is one hour; `idleRestartMs` is configurable; busy processes are not restarted. Idle restart exits Claude consumer and starts a new one in the same tmux container (no tmux kill). | `pnpm test` |
| ACCT-01 | Complete | `test/account-switching.test.ts` | Account switching did not exist. | Desired account switching for idle processes, deferred application for busy, no-op for same account, failure wrapping. | `pnpm test` |
| TASK-01 | Complete | `test/task-execution.test.ts` | Queueing/in-progress behavior did not exist. | Saturated work queues and executes in assignment order. | `pnpm test` |
| TOK-01 | Complete | `test/token-resume.test.ts` | Token-exhaustion resume did not exist. | Token-exhaustion triggers `exitClaude` to capture `ClaudeSessionId`, then `resumeClaude` with `claude --resume <id>`, sends "continue" prompt. Configurable multiple attempts, zero-attempt disable, exhaustion failure after max. | `pnpm test` |
| MODE-01 | Complete | `test/result-modes.test.ts` | One-shot/result modes did not exist. | One-shot output, JSON result parsing, pre-parsed result pass-through, typed parse errors. | `pnpm test` |
| CLEAN-01 | Complete | `test/cleanup.test.ts` | Cleanup behavior did not exist. | Two-phase cleanup: `exitClaude` each consumer then `killSession` each container. Waits for running tasks, cancels queued tasks, skips already-stopped, idempotent, post-cleanup rejection. | `pnpm test` |
| ERR-01 | Complete | `test/error-paths.test.ts` | Typed error paths did not exist. | Startup, task failure, timeout, parse, cleanup, duplicate task ID, post-cleanup rejection, restart failures, and Claude exit failures all raise typed errors. | `pnpm test` |
| WAIT-01 | Complete | `test/wait-for-result.test.ts` | Wait-for-result plumbing did not exist. | Global default `true`, per-task override, propagation through `runOneShot`/`runTask`/resume, `RealTmuxAdapter` polls `capture-pane` until output stabilizes, `readyPattern` detection. | `pnpm test` |
| AGENT-01 | Complete | `test/claude-agent.test.ts` | ClaudeAgent convenience wrapper did not exist. | `ClaudeAgent` wraps `AgentTmuxSdk` for simple one-shot usage. | `pnpm test` |
| INT-01 | Complete | `test/integration/real-tmux.skip-safe.test.ts` | Skip-safe real integration check did not exist. | Local command availability check skips safely when tmux/Claude are unavailable. | `pnpm test` |

## Final command evidence

- `pnpm test`: 14 files, 50 tests passed.
- `pnpm run typecheck`: production and test TypeScript passed.
- `pnpm run lint`: `src/` and `test/` passed.
- `pnpm run build`: ESM, CJS, and declaration output passed.

> 中文版本：[scenario-matrix_zh.md](scenario-matrix_zh.md)

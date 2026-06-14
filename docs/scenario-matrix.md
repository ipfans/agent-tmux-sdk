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
| JSONX-01 | Complete | `test/json-result.test.ts` | Pure JSON extraction/instruction helpers did not exist. | `extractJson` strips ANSI/TUI noise and returns the last balanced value (handles fenced blocks, trailing noise, braces-in-strings, stale scrollback + echoed shape examples); single-line `buildResultInstruction`/`buildRepairInstruction`; defensive `formatSchemaError`. | `pnpm test` |
| REPAIR-01 | Complete | `test/json-repair.test.ts` | Result-mode repair retry did not exist. | Extraction wired into the result path; re-prompts on parse failure (default 3) distinct from token resume; happy-path single execution; exhaustion raises `ResultParseError`; total executions bounded by a ceiling under compounding token resume; oneshot output untouched. | `pnpm test` |
| SCHEMA-01 | Complete | `test/json-schema.test.ts`, `test/public-api-types.test.ts` | Optional schema validation/typing did not exist. | Structural `SchemaLike` (Zod-compatible) validates parsed JSON and types the result via inference; validation failure folds into the repair re-prompt; non-Zod `safeParse` accepted; missing `safeParse` raises a typed error; absent schema returns untyped JSON; no zod in published types. | `pnpm test`, `pnpm run typecheck` |
| INT-01 | Complete | `test/integration/*.integration.test.ts` | Real tmux/Claude end-to-end coverage did not exist (only an availability stub). | Opt-in suite (`pnpm test:integration` / `RUN_INTEGRATION`, skip-safe): one-shot + plain text, controlled concurrency (pre-warmed peak == poolSize), JSON result with schema (incl. multi-screen and reused-slot). Excluded from the default fast suite. | `pnpm test:integration` (real), `pnpm test` (excluded), `pnpm run typecheck` |

## Final command evidence

- `pnpm test`: 18 files, 122 tests passed (fast, fake-only; integration excluded).
- `pnpm test:integration`: 3 real tmux/Claude suites, opt-in and skip-safe.
- `pnpm run typecheck`: production and test TypeScript passed.
- `pnpm run lint`: `src/` and `test/` passed.
- `pnpm run build`: ESM, CJS, and declaration output passed (no `zod` in `dist`).

> 中文版本：[scenario-matrix_zh.md](scenario-matrix_zh.md)

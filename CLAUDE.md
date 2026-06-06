# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TypeScript SDK for orchestrating tmux sessions with Claude CLI to build multi-agent workflows. Zero production dependencies by design.

## Commands

```bash
pnpm run build        # tsup → ESM + CJS + .d.ts
pnpm run dev          # tsup --watch
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint src/
pnpm test             # vitest run
pnpm test:watch       # vitest (watch mode)
```

## TypeScript

- Strict mode with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- Target ES2022, module ESNext with bundler resolution
- Dual-format output: ESM (`.js`) and CJS (`.cjs`) with declaration files

## Error Handling

- Throw typed `Error` subclasses, not generic `Error`
- Define domain-specific error classes (e.g., `TmuxError`, `AgentError`)

## Design Principles

- KISS — keep implementations simple and direct
- DRY — extract only when duplication is real, not anticipated
- SOLID — but don't over-engineer; no abstractions for hypothetical future needs
- Use state machines when managing complex lifecycle transitions
- Prefer `node:child_process` `execFile`/`spawn` over `exec` to avoid shell injection

## Prerequisites

- tmux installed and in `$PATH`
- Claude CLI installed and authenticated
- Node.js >= 20, pnpm 11.5.1

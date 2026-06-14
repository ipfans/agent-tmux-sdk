import { defineConfig } from "vitest/config";

/**
 * Real tmux + Claude integration suite. Opt-in only — run via
 * `pnpm test:integration` (which sets RUN_INTEGRATION=1). The default
 * `pnpm test` excludes `test/integration/**` entirely (see vitest.config.ts),
 * so this config is the only entry point for the live suite.
 *
 * Timeouts are generous: each real Claude turn can take seconds to minutes, and
 * the concurrency scenario drives many turns across a pool.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["test/integration/**/*.test.ts"],
    // Run suites one file at a time — real Claude instances are heavy and
    // running every file in parallel would spawn too many concurrent sessions.
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});

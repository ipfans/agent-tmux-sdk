import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Real tmux + Claude integration tests run only via `pnpm test:integration`
    // (vitest.integration.config.ts). Keep the default run fast and fake-only.
    exclude: [...configDefaults.exclude, "test/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});

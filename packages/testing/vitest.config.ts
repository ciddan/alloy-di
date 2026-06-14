import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Adapter smoke tests for non-Vitest runners live in src/runner-tests and
    // are executed by their own runners (node:test / Jest), not Vitest.
    exclude: [...configDefaults.exclude, "src/runner-tests/**"],
    coverage: {
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "./src/adapters/**",
        "**/*.test.ts",
      ],
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./analytics/coverage",
    },
    globals: false,
    environment: "node",
  },
});

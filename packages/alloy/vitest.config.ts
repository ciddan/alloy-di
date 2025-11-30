import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "./src/test.ts",
        "./src/rollup.ts",
        "./src/runtime.ts",
        "./src/vite.ts",
        "**/*.test.ts",
        "./tests/**",
      ],
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./analytics/coverage",
    },
    globals: false,
    environment: "node",
  },
});

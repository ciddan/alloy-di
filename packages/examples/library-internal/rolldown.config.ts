import { dts } from "rolldown-plugin-dts";
import pkg from "./package.json" with { type: "json" };
import { defineConfig } from "rolldown";
import { alloy } from "alloy-di/rollup";

const dependencyNames = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
];

const external = (id: string) =>
  dependencyNames.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig([
  {
    // Multi-entry build to flatten output while retaining per-service chunks
    input: {
      index: "src/index.ts",
      "analytics-service": "src/analytics-service.ts",
      "event-tracker": "src/event-tracker.ts",
      "user-session": "src/user-session.ts",
      "reporting-service": "src/reporting-service.ts",
      providers: "src/providers.ts",
    },
    tsconfig: "./tsconfig.json",
    output: {
      dir: "dist",
      format: "es",
      // Flatten: no preserveModules; each entry emits a single chunk
      entryFileNames: "[name].js",
      preserveModules: true,
      sourcemap: true,
    },
    external,
    plugins: [
      alloy({
        // Include provider modules so consumers can auto-apply runtime registrations
        providers: ["src/providers.ts"],
      }),
      dts(),
    ],
  },
]);

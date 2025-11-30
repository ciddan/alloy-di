import { dts } from "rolldown-plugin-dts";
import pkg from "./package.json" with { type: "json" };
import { defineConfig } from "rolldown";

const external = Object.keys(pkg.devDependencies || {});

export default defineConfig([
  {
    input: {
      index: "src/index.ts",
      logger: "src/logger.ts",
      "console-output": "src/console-output.ts",
    },
    tsconfig: "./tsconfig.json",
    output: {
      dir: "dist",
      format: "es",
      entryFileNames: "[name].js",
      sourcemap: true,
    },
    external,
    plugins: [dts()],
  },
]);

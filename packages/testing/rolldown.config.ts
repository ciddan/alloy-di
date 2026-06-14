import { mkdir, stat } from "node:fs/promises";
import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

import pkg from "./package.json" with { type: "json" };

const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "alloy-di",
  "alloy-di/runtime",
  "alloy-di/scopes",
  "vitest",
  "@jest/globals",
  /^node:.*/,
];

const distExists = await stat("dist")
  .then((stat) => stat.isDirectory())
  .catch(() => false);

if (!distExists) {
  await mkdir("dist");
}

export default defineConfig([
  {
    input: {
      index: "src/index.ts",
      "adapters/vitest": "src/adapters/vitest.ts",
      "adapters/jest": "src/adapters/jest.ts",
      "adapters/node": "src/adapters/node.ts",
    },
    tsconfig: "./tsconfig.json",
    output: {
      dir: "dist",
      format: "es",
      entryFileNames: "[name].js",
      preserveModules: true,
      sourcemap: false,
    },
    external,
    plugins: [dts()],
  },
]);

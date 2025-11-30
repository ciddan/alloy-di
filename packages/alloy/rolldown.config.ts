import { mkdir, stat } from "node:fs/promises";
import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";
import { visualizer } from "rollup-plugin-visualizer";

import pkg from "./package.json" with { type: "json" };

const external = [
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "vite",
  "vitest",
  "typescript",
  "path",
  /^node:.*/,
  "node:url",
  "zod",
];

const distExists = await stat("dist")
  .then((stat) => stat.isDirectory())
  .catch(() => false);

if (!distExists) {
  await mkdir("dist");
}

export default defineConfig([
  // Bundle the main plugin and runtime code
  {
    input: {
      vite: "src/vite.ts",
      rollup: "src/rollup.ts",
      runtime: "src/runtime.ts",
      test: "src/test.ts",
    },
    tsconfig: "./tsconfig.json",
    output: {
      dir: "dist",
      format: "es",
      entryFileNames: "[name].js",
      sourcemap: true,
    },
    external,
    plugins: [
      dts(),
      visualizer({
        gzipSize: true,
        filename: "./analytics/bundle-stats.html",
      }),
      visualizer({
        gzipSize: true,
        filename: "./analytics/bundle-stats.json",
        template: "raw-data",
      }),
    ],
  },
]);

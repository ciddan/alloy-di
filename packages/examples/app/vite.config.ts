import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import alloy from "alloy-di/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { ReportingServiceIdentifier } from "@alloy-di/example-library-internal/service-identifiers";
import { manifest } from "@alloy-di/example-library-internal/manifest";

export default defineConfig(async () => {
  return {
    server: {
      port: 5273,
    },
    build: {
      minify: false,
      sourcemap: true,
    },
    plugins: [
      react(),
      alloy({
        providers: ["src/providers.ts"],
        manifests: [manifest],
        lazyServices: [ReportingServiceIdentifier],
        visualize: {
          mermaid: {
            outputPath: "./analytics/container.mmd",
          },
        },
      }),
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
  };
});

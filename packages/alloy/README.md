# alloy-di

`alloy-di` is a compile-time dependency injection toolkit for Vite. It scans your TypeScript during build, generates a static container, and ships a tiny runtime so you get dependency injection without reflection overhead.

## Highlights

- **Build-time graph** – services, scopes, and dependencies are resolved while bundling, so runtime work stays minimal.
- **Visualize your DI graph** – enable the Vite plugin’s `visualize` option to emit a Mermaid diagram (`./alloy-di.mmd` by default) that captures scopes, lazy edges, and tokens for easy review.
- **First-class lazy loading** – use `Lazy()` or provider-based lazy registrations to keep optional features in separate chunks.
- **Framework agnostic** – works anywhere Vite runs: React, Vue, Svelte, SSR, libraries, and plain TS apps.
- **Type safe** – generates `serviceIdentifiers` and manifest declarations for precise inference.

## Install

```bash
pnpm add -D alloy-di
```

## 30‑second setup

1. **Add the Vite plugin**

   ```ts
   import { defineConfig } from "vite";
   import alloy from "alloy-di/vite";

   export default defineConfig({
     plugins: [alloy()],
   });
   ```

2. **Annotate services**

   ```ts
   import { Injectable, Singleton, deps } from "alloy-di/runtime";

   @Singleton()
   export class ServiceA {}

   @Injectable(deps(ServiceA))
   export class AppService {
     constructor(private readonly serviceA: ServiceA) {}
   }
   ```

3. **Resolve from the virtual container**

   ```ts
   import container, { serviceIdentifiers } from "virtual:alloy-container";

   const app = await container.get(serviceIdentifiers.AppService);
   ```

> **Build tip:** The default Vite scaffold (`pnpm create vite@latest`) wires `"build": "tsc && vite build"`. Alloy writes its ambient declarations during `vite build`, so running `tsc` first can fail on fresh trees. Swap the order (`vite build && tsc`), or manually run `vite build` to generate the declarations first.

Need manifests, providers, or testing utilities? See the docs site for complete guides.

## Visualize your dependency graph

Enable the Vite plugin’s `visualize` option to have Alloy emit a Mermaid diagram that reflects every discovered service, scope, lazy edge, and token. By default the graph is written to `./alloy-di.mmd`, but you can customize the output path, color palette, or layout direction to fit your workflow.

```ts
import { defineConfig } from "vite";
import alloy from "alloy-di/vite";

export default defineConfig({
  plugins: [
    alloy({
      visualize: {
        mermaid: {
          outputPath: "./docs/di-graph.mmd",
          direction: "TB",
          includeLegend: false,
        },
      },
    }),
  ],
});
```

Commit the artifact for PR reviews, or generate ad-hoc previews locally with any Mermaid-friendly tool (for example VS Code’s Mermaid extension, GitHub’s Markdown preview, or `npx @mermaid-js/mermaid-cli -i docs/di-graph.mmd -o graph.svg`). The diagram highlights scopes, lazy edges, factory nodes, and tokens so you can inspect DI wiring at a glance.

## Documentation

- **Website**: https://alloy-di.dev (generated from `/docs`)
- **Develop locally**: `pnpm docs:dev`
- **Build static site**: `pnpm docs:build`

The site covers getting started, plugin options, manifest authoring, lazy loading, testing helpers, and architecture deep dives.

## Examples in this repo

- `packages/examples/app` – React + Vite app consuming decorated services, manifests, and providers.
- `packages/examples/library-internal` – monorepo library that emits `alloy.manifest.mjs` via the Rolldown plugin.
- `packages/examples/library-external` – plain classes registered through providers.

Clone the repo, run `pnpm install`, then `pnpm --filter @alloy-di/example-app dev` to explore.

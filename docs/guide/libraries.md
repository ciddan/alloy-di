# Authoring Internal Libraries with Alloy

This guide walks through enabling Alloy decorators in your internal monorepo libraries, emitting a manifest during the library build, and consuming those services seamlessly in your app.

## Prerequisites

- Monorepo managed with pnpm/turborepo (or similar)
- Vite app that uses `alloy-di/vite`
- Internal library built with Rollup/Rolldown

## Overview

Alloy supports internal libraries via an ESM manifest (`alloy.manifest.mjs`) produced during the library build. The app-side Alloy plugin ingests this manifest and generates a single container that:

- Statically imports eager services
- Emits `Lazy(() => import(...))` for lazy deps
- Handles class-name collisions by aliasing imports deterministically

## Library Setup (Emit Manifest)

1. Add the Alloy manifest plugin to your internal library build.

   ```ts
   // packages/my-lib/rolldown.config.ts
   import { dts } from "rolldown-plugin-dts";
   import pkg from "./package.json" with { type: "json" };
   import { defineConfig } from "rolldown";
   import { alloy } from "alloy-di/rollup";

   const external = [
     ...Object.keys(pkg.dependencies || {}),
     ...Object.keys(pkg.devDependencies || {}),
   ];

   export default defineConfig([
     {
       input: { index: "src/index.ts" },
       tsconfig: "./tsconfig.json",
       output: {
         dir: "dist",
         format: "es",
         entryFileNames: "[name].js",
         sourcemap: true,
       },
       external,
       plugins: [alloy(), dts()],
     },
   ]);
   ```

2. Author services with Alloy decorators in your library.

   ```ts
   // packages/my-lib/src/analytics-service.ts
   import { Singleton } from "alloy-di/runtime";

   @Singleton()
   export class AnalyticsService {
     track(name: string, data?: unknown) {}
   }
   ```

   ```ts
   // packages/my-lib/src/event-tracker.ts
   import { Injectable, deps } from "alloy-di/runtime";
   import { AnalyticsService } from "./analytics-service";

   @Injectable(deps(AnalyticsService))
   export class EventTracker {
     constructor(private analytics: AnalyticsService) {}
     trackPageView(page: string) {
       this.analytics.track("page_view", { page });
     }
   }
   ```

3. Ensure public exports (at least in `src/index.ts`). When building without `preserveModules`, the manifest references the root import path. Missing named exports are reported in manifest diagnostics.

   ```ts
   // packages/my-lib/src/index.ts
   export { AnalyticsService } from "./analytics-service";
   export { EventTracker } from "./event-tracker";
   ```

4. Build the library. This emits `dist/alloy.manifest.mjs` alongside JS output.

   ```zsh
   pnpm --filter @upn/my-lib run build
   ```

## App Setup (Consume Manifest)

1. Import the manifest from your library and configure the Alloy Vite plugin.

   ```ts
   // packages/app/vite.config.ts
   import { defineConfig } from "vite";
   import { alloy } from "alloy-di/vite";
   import { manifest } from "@upn/my-lib/manifest";

   export default defineConfig({
     plugins: [
       alloy({
         providers: ["src/providers.ts"],
         manifests: [manifest],
       }),
     ],
   });
   ```

2. Import services from your library and resolve them via the container.

   ```ts
   // packages/app/src/analytics-consumer.ts
   import { Injectable, deps } from "alloy-di/runtime";
   import { EventTracker, AnalyticsService } from "@upn/my-lib";

   @Injectable(deps(EventTracker, AnalyticsService))
   export class AnalyticsConsumer {
     constructor(
       private tracker: EventTracker,
       private analytics: AnalyticsService,
     ) {}
     initialize() {
       this.tracker.trackPageView("home");
     }
   }
   ```

3. Run the app. The manifest descriptors are merged into the generated container; eager deps are imported statically and lazy deps use dynamic imports.

## Build Modes & Import Paths

- Bundled (default): services import from the package root (e.g., `@upn/my-lib`). Ensure named exports in `src/index.ts`.
- Preserve Modules: services import from subpaths (e.g., `@upn/my-lib/event-tracker`). Improves tree-shaking.

The manifest plugin detects the build mode and emits corresponding `importPath` values. Diagnostics include a `missingExports` list when bundled and symbols aren’t exported from the barrel.

## Lazy Dependencies

Use `Lazy(() => import('...').then(m => m.Export))` for lazy deps. The manifest serializes lazy deps as descriptors; the consumer plugin emits `Lazy(...)` expressions in the generated container so imports remain deferred until resolution.

```ts
import { Injectable, Lazy, deps } from "alloy-di/runtime";

@Injectable(deps(Lazy(() => import("@upn/my-lib").then((m) => m.EventTracker))))
export class UsesLazy {
  constructor(private t: import("@upn/my-lib").EventTracker) {}
}
```

## Troubleshooting

### Missing exports (bundled builds)

- Symptom: Service appears in `missingExports` diagnostics; app fails to import or resolve it.
- Fix:
  - Export the service from your barrel `src/index.ts`.
  - Or switch to `preserveModules` to enable subpath imports.
  - Verify the package name and `importPath` emitted in `dist/alloy.manifest.mjs`.

### Alias collisions (duplicate class names)

- Symptom: Multiple services share the same class name across files/packages.
- Behavior: The consumer plugin aliases imported symbols deterministically (e.g., `Service__<hash>`). Container registrations reference the aliased identifiers; runtime resolution remains correct.
- Fix:
  - Prefer unique class names in public APIs.
  - If collisions are expected, rely on the plugin’s aliasing; no action needed in application code.

### Incorrect lazy dep specifier

- Symptom: Lazy dep fails to load or resolves to `undefined`.
- Fix:
  - Ensure `importPath` points to a public specifier (root for bundled; subpath for preserve-modules).
  - Ensure `exportName` matches the actual named export.
  - For bundled builds, confirm the target symbol is included in `src/index.ts`.

## Recommendations

- Prefer `deps(...)` over array literals for strict tuple inference in TypeScript.
- Add a `package.json` field in your library for tooling clarity:

  ```json
  {
    "name": "@upn/my-lib",
    "alloy": { "manifest": "./dist/alloy.manifest.mjs" }
  }
  ```

- Consider `preserveModules` for larger libraries to improve tree-shaking and minimize barrel coupling.
- Use tokens for value injection into services when appropriate (see `createToken` in the API surface).

## References

- Manifest Schema: `packages/alloy/src/manifest-plugin.ts`
- Consumer Plugin: `packages/alloy/src/plugin/index.ts`
- API Surface: https://alloy-di.dev/api/

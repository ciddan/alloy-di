# Plugin Architecture

The application build plugins are split across a shared consumer layer plus thin bundler adapters so Vite can keep its dev-server behavior while webpack/Rspack reuse the same discovery and codegen path.

## File layout

```
packages/alloy/src/plugins/
├── consumer-plugin.ts    # Shared app-plugin state (options, discovery, virtual container loading)
├── vite-plugin/
│   └── index.ts          # Vite adapter (hook filters, HMR invalidation)
├── webpack-like-plugin.ts # Shared webpack/Rspack adapter implementation
├── core/
│   ├── codegen.ts        # Generates virtual container module (imports, stubs, registrations, provider application)
│   ├── scanner.ts        # Decorator + Lazy discovery via the TypeScript compiler AST
│   ├── lazy.ts           # Detects Lazy(...) calls and extracts class keys
│   ├── types.ts          # Shared metadata types used by plugins/core
│   └── utils.ts          # General helpers (paths, hashing, alias generation)
├── rollup-plugin/
│   └── index.ts          # Rolldown/Rollup manifest plugin (emits alloy.manifest.mjs)
```

## Responsibilities

### `consumer-plugin.ts`

- Keeps build-time state (`discoveredClasses`, file indexes, lazy reference indexes).
- Drives the AST walk, deferring to helpers for decorator parsing and lazy tracking.
- Generates the virtual module by delegating to `codegen.ts`.
- Ingests internal library manifests, merging discovered services with manifest-described ones.
- Imports provider modules (from config and manifests) and applies them in the generated container.
- Throws a helpful error when duplicate service registrations are detected (same class name discovered locally and provided via manifest).

### `vite-plugin/index.ts`

- Hosts the Vite `alloy()` factory.
- Preserves the object-hook filters used by Vite/Rolldown.
- Keeps Vite's full-reload HMR path when the discovered service graph changes.

### `webpack-like-plugin.ts`

- Hosts the shared webpack/Rspack adapter implementation.
- Resolves `virtual:alloy-container` to a generated cache module.
- Rescans configured `sourceDirs` on compile/watch cycles and registers watch dependencies.

### `core/codegen.ts`

- Receives the discovered metadata and lazy-only class keys.
- Builds import statements, resolves name collisions via aliases, and emits the registration array + container boilerplate.

### `core/scanner.ts`

- Walks the TypeScript compiler AST to collect decorated classes and extract their decorator options.
- Delegates `Lazy(...)` detection to `core/lazy.ts`, recording unique class keys for codegen decisions.

### `core/utils.ts`

- Shared helpers for hashing, alias creation, and POSIX path normalization used across plugins.

## Flow overview

1. `alloy()` registers bundler hooks through the Vite, webpack, or Rspack adapter.
2. The shared consumer context scans TypeScript ASTs, records decorated classes, and forwards call expressions to `processLazyCall` from `core/lazy.ts`.
3. When the adapter needs `virtual:alloy-container`, the shared consumer context passes the collected metadata + lazy-only set into `generateContainerModule()`.
4. The generated container imports only eagerly referenced services; lazy-only and factory-lazy (`lazyServices`) entries receive stubs plus `factory: Lazy(...)` metadata.
5. Provider modules are imported and `applyProviders(container, ...)` is invoked after decorator-based registrations, enabling external libraries to register values, services, and lazy services.

This separation keeps each concern small and makes future additions (e.g., factory-lazy strategies, incremental scanning, new analysers) straightforward.

## `lazyServices` Option

Add `ServiceIdentifier` symbols to `lazyServices` in plugin config to lazily import entire service modules:

```ts
import { serviceIdentifiers } from "./src/virtual-container";

alloy({
  lazyServices: [serviceIdentifiers.ReportingService],
});
```

Codegen behavior:

- Omits static import for those classes.
- Synthesizes empty stub class with the same name (DI key).
- Injects `factory: Lazy(() => import(<path>).then(m => m.<Name>))` into registration metadata.
- First resolution triggers dynamic chunk load via container.

Import `{ serviceIdentifiers }` from `virtual:alloy-container` and call `container.get(serviceIdentifiers.ReportingService)` to resolve without importing the class symbol when type info is not required at runtime.

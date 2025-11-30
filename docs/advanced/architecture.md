# Plugin Architecture

The Vite plugin is intentionally split across a few focused modules so it is easier to follow and to extend.

## File layout

```
packages/alloy/src/plugins/
├── vite-plugin/
│   └── index.ts          # Main Vite plugin entry point (discovery, manifest ingestion, provider imports)
├── core/
│   ├── codegen.ts        # Generates virtual container module (imports, stubs, registrations, provider application)
│   ├── scanner.ts        # Decorator + Lazy discovery (AST-like text scanning)
│   ├── types.ts          # Shared metadata types used by plugins/core
│   └── utils.ts          # General helpers (paths, hashing, alias generation)
├── rollup-plugin/
│   └── index.ts          # Rolldown/Rollup manifest plugin (emits alloy.manifest.mjs)
```

## Responsibilities

### `vite-plugin/index.ts`

- Hosts the `alloy()` factory.
- Keeps build-time state (`discoveredClasses`, file indexes, lazy reference indexes).
- Drives the AST walk, deferring to helpers for decorator parsing and lazy tracking.
- Generates the virtual module by delegating to `codegen.ts`.
- Ingests internal library manifests, merging discovered services with manifest-described ones.
- Imports provider modules (from config and manifests) and applies them in the generated container.
- Throws a helpful error when duplicate service registrations are detected (same class name discovered locally and provided via manifest).

### `core/codegen.ts`

- Receives the discovered metadata and lazy-only class keys.
- Builds import statements, resolves name collisions via aliases, and emits the registration array + container boilerplate.

### `core/scanner.ts`

- Parses source text to collect decorated classes and extracts raw options text.
- Detects `Lazy(...)` references and records unique class keys for codegen decisions.

### `core/utils.ts`

- Shared helpers for hashing, alias creation, and POSIX path normalization used across plugins.

### `vite-plugin/utils.ts`

- Shared helpers for hashing, alias creation, and POSIX path normalization used by both the discoverer and the code generator.

## Flow overview

1. `alloy()` registers Vite hooks using the state holders in `plugin/index.ts`.
2. During `transform`, the AST walker records decorated classes and forwards every call expression to `processLazyCall` from `lazy.ts`.
3. When Vite requests the `virtual:alloy-container` module, the plugin passes the collected metadata + lazy-only set into `generateContainerModule()`.
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

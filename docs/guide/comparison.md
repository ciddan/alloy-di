# Alloy vs. Other TypeScript DI Frameworks

A comparison of Alloy against the major TypeScript dependency-injection
libraries. The goal is an honest picture — where Alloy's approach is genuinely
differentiated, and where more established containers still have the edge.

> [!NOTE]
> This page is a working draft and is not yet linked from the sidebar.

## The defining axis: build-time vs. runtime

Nearly every mainstream TypeScript DI container resolves and validates its graph
**at runtime**. Alloy is one of the few that does the work **at build time** — a
Vite/Rollup plugin statically discovers `@Injectable`/`@Singleton` classes,
generates the container as a virtual module, and bakes the dependency graph into
generated code.

That single choice drives most of Alloy's advantages and most of its gaps.

## Feature matrix

| Dimension                             | **Alloy**                                     | InversifyJS                     | tsyringe                       | NestJS DI                     | TypeDI                | Awilix                         | Brandi / Ditox                             |
| ------------------------------------- | --------------------------------------------- | ------------------------------- | ------------------------------ | ----------------------------- | --------------------- | ------------------------------ | ------------------------------------------ |
| Resolution                            | **Build-time discovery + runtime graph**      | Runtime                         | Runtime                        | Runtime                       | Runtime               | Runtime                        | Runtime                                    |
| `reflect-metadata`                    | **No**                                        | Yes                             | Yes                            | Yes                           | Yes                   | No                             | No                                         |
| Decorators                            | Markers only (parsed statically)              | Yes (+metadata)                 | Yes (+metadata)                | Yes (+metadata)               | Yes (+metadata)       | Optional                       | No                                         |
| Auto-discovery                        | **Yes (static scan)**                         | No (manual bind)                | Partial (metadata)             | No (modules)                  | Partial               | No (manual reg)                | No (manual)                                |
| Build-time validation (cycles/dupes)  | **Yes**                                       | No                              | No                             | No                            | No                    | No                             | No                                         |
| Bundler-native code-splitting / lazy  | **Yes (`Lazy(() => import())`)**              | No                              | No                             | No                            | No                    | No                             | No                                         |
| Dependency-graph visualization        | **Yes (Mermaid)**                             | No                              | No                             | No                            | No                    | No                             | No                                         |
| Scopes                                | singleton / transient (hierarchical proposed) | singleton / transient / request | singleton / transient / scoped | default / request / transient | singleton / transient | singleton / scoped / transient | singleton / scoped / transient / container |
| Interceptors / AOP                    | Proposed                                      | Middleware                      | No                             | Interceptors (framework)      | No                    | No                             | No                                         |
| Multi-injection / tagged / contextual | **No**                                        | Yes (rich)                      | Limited                        | Via modules                   | Limited               | Limited                        | Limited                                    |
| Sync resolution                       | **No (async `get`)**                          | Yes                             | Yes                            | Yes                           | Yes                   | Yes                            | Yes                                        |
| Primary target                        | **Frontend / Vite**                           | Backend                         | Either                         | Backend (Nest)                | Backend               | Backend / Node                 | Frontend                                   |
| Runtime footprint                     | **Minimal, tree-shakeable**                   | Heavy                           | Light                          | Heavy                         | Medium                | Medium                         | Tiny                                       |

## Where Alloy wins

1. **Fail at build, not in production.** Circular dependencies and duplicate
   registrations are caught during the build. Every runtime container only
   throws when the offending path is first resolved. The proposed scope-stability
   validation extends this to captive-dependency bugs — a class of error other
   containers cannot catch statically at all.

2. **Bundler-native lazy loading and code-splitting.**
   `Lazy(() => import('./Heavy'))` makes a dependency a real dynamic-import
   boundary, so the DI graph and the bundler's chunk graph are the same graph. No
   other library here participates in code-splitting — they are bundler-agnostic
   and can't help you defer loading a service. For frontend bundle budgets this
   is Alloy's standout feature.

3. **No `reflect-metadata`, no global polyfill, no `emitDecoratorMetadata`.**
   Inversify, tsyringe, Nest, and TypeDI all require the reflect-metadata
   polyfill and decorator-metadata emission. Alloy shares "no reflect-metadata"
   with Awilix, Brandi, and Ditox — but unlike those it still gives you
   **automatic discovery** instead of a manual `bind`/`register` call per
   service.

4. **Minimal, tree-shakeable runtime.** The runtime is a small `Container` plus
   helpers, shipped via subpath exports with no import-time side effects.
   Inversify and Nest carry substantial runtime machinery.

5. **Static typing without metadata magic.** Tuple-inferred `deps(...)` plus the
   zero-cost `assertDeps` align declared dependencies with constructor
   parameters at compile time. Stable symbol `ServiceIdentifier`s survive
   minification and code-splitting — a real concern for frontend bundles.

6. **A library/monorepo story via manifests.** Alloy can ingest pre-built
   manifests from libraries (decorated internal libs, or provider-based external
   libs), which is more structured than most runtime containers' "import and
   bind" approach.

## Where Alloy has gaps

1. **Ecosystem maturity and adoption.** Inversify, tsyringe, and Nest are
   battle-tested with large communities and many integrations. Alloy is early,
   with a smaller surface and fewer escape hatches when you hit an edge case.

2. **Build-step lock-in.** Because resolution is build-time, Alloy needs the
   Vite/Rollup plugin. Runtime containers work anywhere — plain Node, `ts-node`,
   Deno, a REPL, a serverless function with no bundling.

3. **Async-only resolution.** `container.get()` returns a `Promise`, a
   deliberate consequence of supporting lazy dynamic imports. Most competitors
   offer synchronous resolution, which is more ergonomic when you just want an
   instance now.

4. **Feature breadth vs. Inversify/Nest.** Alloy currently lacks several things
   mature containers ship:
   - **Multi-injection** (inject all implementations of a type),
     **named/tagged bindings**, and **contextual bindings** — entirely absent.
   - **Property / optional injection** — constructor-only today.
   - **Runtime hierarchical scopes** — singleton + transient only (addressed by
     the scopes proposal).
   - **Factory providers and interceptors** — also proposals at present.

5. **Explicit, positional dependency declaration.** You keep `deps(...)` aligned
   with the constructor's parameter order. Metadata-based containers infer
   constructor types automatically. Alloy mitigates with tuple typing and
   `assertDeps`, but it's more ceremony than `@injectable()` plus a typed
   constructor.

6. **Testing requires the registry populated.** Runtime containers are trivially
   unit-testable with `register` + `resolve`. Alloy works (`alloy-di/test`,
   `overrideInstance`, or direct decoration), but tests run through the plugin
   transform or manual registration — a little more setup.

## Positioning

Alloy occupies a niche few others target well: **DI for bundle-size-sensitive
frontend apps that want compile-time safety and code-splitting built into the
dependency graph.** In that niche its advantages — build-time validation,
bundler-native lazy loading, no reflect-metadata, tiny runtime — are
differentiated and hard to replicate with a runtime container.

- **Choose Alloy** for Vite/Rollup frontend apps that care about bundle size,
  lazy loading, and catching wiring errors at build time.
- **Choose Inversify / Nest** when you need rich runtime features
  (multi-injection, contextual bindings, request scopes, mature AOP) or are in a
  backend framework.
- **Choose tsyringe / Awilix / Brandi / Ditox** when you want a small runtime
  container with synchronous resolution and zero build-step coupling.

The active design proposals (hierarchical scopes, factory providers,
interceptors) close the most conspicuous breadth gaps **without** surrendering
the build-time-first identity — each validates or generates code at build time
rather than bolting on runtime machinery.

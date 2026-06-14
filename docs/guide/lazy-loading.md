# Lazy Loading

Alloy supports lazy loading of services to enable granular code splitting and defer expensive module initialization until it's actually needed. There are three ways to make something lazy:

1. **Decorator dependencies** — `Lazy(() => import(...))` inside an `@Injectable` / `@Singleton` dependency array.
2. **Provider placeholders** — `asLazyClass(...)` for services registered without decorators (e.g. external libraries).
3. **Whole-service laziness** — the build plugin's `lazyServices` option, which defers loading an entire service (and all its dependencies) from a manifest-discovered library.

Lazy services still integrate fully with the container: they participate in the dependency graph, respect their lifecycle (singleton vs transient), declare their own dependencies, and can retry flaky dynamic imports with backoff.

## Decorator-Based Lazy Dependency

```ts
import { Injectable, Lazy } from "alloy-di/runtime";
import type { HeavyService } from "./heavy-service"; // type-only import (optional)

@Injectable([Lazy(() => import("./heavy-service").then((m) => m.HeavyService))])
export class FeatureGate {
  constructor(private heavy: HeavyService) {}

  async activate() {
    // First access triggers the dynamic import of the HeavyService chunk.
    await this.heavy.initialize();
  }
}
```

A `Lazy(() => import(...))` dependency is excluded from the container's static imports, so the bundler splits it into its own chunk. The import runs the first time the container resolves the owning service.

### Supported dynamic import shapes

- `Lazy(() => import('./module').then(m => m.Service))`
- `Lazy(() => import('./service'))` (requires a default-exported class)

If the build plugin can't statically analyze the importer (e.g. a computed specifier), it won't treat the dependency as lazy-only and the module may be bundled eagerly.

## Provider-Based Lazy Service

Providers let code register services without Alloy decorators. `asLazyClass` creates a placeholder that stands in for a lazily imported class:

```ts
// external-library/providers.ts
import { defineProviders, asLazyClass, lifecycle } from "alloy-di/runtime";

export default defineProviders({
  lazyServices: [
    asLazyClass(() => import("./heavy-service").then((m) => m.HeavyService), {
      lifecycle: lifecycle.singleton(),
      deps: [
        /* other dependencies of HeavyService */
      ],
      label: "HeavyService",
    }),
  ],
});
```

The placeholder is uninstantiable — attempting to `new` it throws — and carries the lifecycle, dependency declarations, and the lazy importer. Its identity is used as the DI key, so singleton caching and dependency wiring behave exactly like a real class.

Provider modules can register eager services and values alongside lazy ones. The build plugin imports them (from the `providers: [...]` config and from ingested library manifests) and applies them after decorator-based registrations. If the same class name is discovered locally and also provided via a manifest, the plugin fails the build with a duplicate-registration error.

## Whole-Service Laziness (`lazyServices`)

The decorator and provider forms above defer a dependency _at one usage site_ — you write `Lazy(() => import(...))` where it's declared. `lazyServices` instead defers a whole service at the **registration** level: every reference to it resolves lazily, and the service (plus its dependency subtree) loads as a single chunk on first use. Reach for it when there's no one site to wrap — typically a service you resolve directly by identifier, or one that ships pre-decorated in a library you consume via a [manifest](/guide/libraries).

Opt a service in with the identifier its library exports from the generated `…/service-identifiers` module:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { alloy } from "alloy-di/vite";
import { ReportingServiceIdentifier } from "@acme/my-lib/service-identifiers";

export default defineConfig({
  plugins: [
    alloy({
      lazyServices: [ReportingServiceIdentifier],
    }),
  ],
});
```

Effects:

1. The service is not imported statically in the generated container; a stub class stands in as the DI key.
2. Registration metadata carries `factory: Lazy(() => import(...))`, so the first `container.get(ReportingServiceIdentifier)` triggers the dynamic import.

Resolve these services by **identifier**, not by constructor — importing the constructor risks pulling the implementation into the eager chunk, and doing so emits a dev-time warning. Use `import type { ReportingService } from "@acme/my-lib"` when you need the type for annotations:

```ts
import container from "virtual:alloy-container";
import { ReportingServiceIdentifier } from "@acme/my-lib/service-identifiers";

const reporting = await container.get(ReportingServiceIdentifier);
```

## Retry & Backoff

`Lazy(importer, { retries, backoffMs, factor })` makes loading resilient to flaky or delayed chunks:

1. Attempt the import.
2. On failure with retries remaining, wait `backoffMs * factor^attempt`, then retry.
3. After the final failure, throw an aggregated error that preserves the original cause.

```ts
const ResilientService = Lazy(
  () => import("./resilient").then((m) => m.ResilientService),
  { retries: 3, backoffMs: 200, factor: 2 },
);
```

Retry works for both decorator and provider usages.

## Code-Splitting Guarantees

A lazy-marked class is kept out of the eager bundle when:

1. The `Lazy(...)` call matches one of the analyzable shapes above.
2. The class isn't also referenced eagerly elsewhere (any eager reference wins, and the class is bundled).
3. For providers, the placeholder metadata is applied.

If a condition isn't met the class still works — it's just included eagerly rather than split.

## Choosing an Approach

| Goal                                                                          | Use                        |
| ----------------------------------------------------------------------------- | -------------------------- |
| Defer one dependency of a service you own                                     | **Decorator** `Lazy()`     |
| Register/defer a service without decorators (external lib)                    | **Provider** `asLazyClass` |
| Defer a whole service everywhere at once (e.g. one you resolve by identifier) | **`lazyServices`** option  |

Decorator and provider forms interoperate — a single container graph can mix both. Only the specifically wrapped dependencies are deferred, so you can freely combine lazy and eager dependencies on the same service.

> Circular dependencies are detected by resolution-stack tracking. A lazy boundary does **not** automatically break a cycle if two services directly require each other.

## Error Cases

| Scenario                             | Error                                                        | Mitigation                                                |
| ------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------- |
| Instantiating a placeholder directly | "Lazy provider placeholders cannot be instantiated directly" | Always resolve via `container.get`                        |
| Importer returns a non-constructor   | "Lazy importer did not return a class"                       | Ensure the module exports a class (default or named)      |
| Token missing a value provider       | "No provider registered for token ..."                       | Register via `container.provideValue` or a value provider |
| Retries exhausted                    | "Failed to import lazy dependency ..."                       | Increase `retries` or verify the chunk path               |

## FAQ

**Can I lazy-load a value provider?**

Values are usually small. If one is expensive to construct, use a [factory provider](/guide/factory-providers) so it's computed on first resolution. Code-splitting applies to classes via `Lazy()`, not to values.

**Do retries apply to provider placeholders?**

Yes — the underlying `Lazy` wrapper supports retry across decorator and provider usage.

**Can I mix lazy and eager dependencies on one service?**

Yes. Only the wrapped dependencies are deferred.

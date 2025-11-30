# API Surface

## Runtime API

### `container.get<T>(target: Newable<T> | ServiceIdentifier<T>): Promise<T>`

Resolves (and constructs) the requested service.

- If passed a class constructor (`Newable<T>`), it resolves dependencies and instantiates the class.
- If passed a `ServiceIdentifier<T>`, it resolves the service associated with that identifier (useful for lazy services or minifier-safe resolution).

If the service is a registered singleton, it returns the existing instance. Returns a `Promise` because dependencies might be lazy-loaded.

```ts
// Resolve by constructor
const appService = await container.get(AppService);

// Resolve by identifier (e.g. for lazy services)
import { serviceIdentifiers } from "virtual:alloy-container";
const reporting = await container.get(serviceIdentifiers.ReportingService);
```

Prefer identifier-based lookups in browser bundles so factory-lazy services stay tree-shakeable; the constructor overload remains for tests and Node-only usage, but resolving a factory-lazy service by constructor now emits a dev-time warning to remind you to switch to identifiers when targeting client code.

Note: tokens (see below) cannot be resolved directly via `get`; register a class that depends on a token instead.

### `container.getByIdentifier<T>(identifier: ServiceIdentifier<T>): Promise<T>`

Resolves a service using a stable, minifier-safe identifier. This is the underlying implementation of `container.get(identifier)`.

```typescript
import container, { serviceIdentifiers } from "virtual:alloy-container";

// Resolve via build-time generated identifier (no app-side imports required)
const reporting = await container.get(serviceIdentifiers.ReportingService);

// Obtain an identifier at runtime when you do have the constructor
import { ReportingService } from "./reporting-service";
const id = container.getIdentifier(ReportingService);
const reportingInstance = await container.get(id);
```

Use this when leveraging `lazyServices` or when consuming services discovered via manifests, ensuring your lookups remain robust after bundler minification and suppressing the constructor warning for factory-lazy services.

### Testing Helpers (`alloy-di/test`)

The testing entrypoint provides utilities for constructing a test-focused container and automocking dependencies.

- `createTestContainer(options)`: Builds a container with optional `providers`, manual `overrides`, and `autoMock` targeting a specific `target` class.
  - `providers?: ProviderDefinitions | ProviderDefinitions[]`
  - `overrides?: { instances?: Array<[Newable, instance]>; tokens?: Array<[Token<T>, T]> }`
  - `autoMock?: boolean`
  - `target?: Newable`
  - Returns handle with `get`, `getToken`, `provideToken`, `getMock`, `getMocks`, `restore`.
- `MockOf<T>`: Typed shape of an auto-generated mock with `spies` and `__target`.
- `createToken(description?)`: Re-export for convenience in tests.

Vitest is required: `vitest >=4.0.14 <5.0.0`.

See the dedicated guide: [Testing and Mocking with Alloy](../guide/testing.md).

## `@Injectable(depsOrScope?: Dependencies, scope?: ServiceScope)`

A class decorator that configures a service's dependencies and lifetime.

- The first argument accepts either:
  - A readonly tuple of constructors/Lazy/Token entries (e.g., `[Logger, Metrics]`).
  - A function returning that tuple (recommended for circular references or deferred evaluation).
  - A scope string (`'singleton' | 'transient'`) when no dependencies are provided.
- The optional second argument lets you specify the scope when the first argument declares dependencies (defaults to `'transient'`).

## `@Singleton(deps?: Dependencies)`

A shorthand for declaring a singleton service. It is equivalent to `@Injectable(deps?, 'singleton')`.

> The generated container reads the decorator metadata directly—there is no separate `container.singleton(...)` call to make.

## `Lazy<T>(importer: () => Promise<any>, retry?: { retries: number; backoffMs?: number; factor?: number }): Lazy<T>`

Marks a dependency for deferred dynamic import via `import()`. The importer function must resolve to a module containing a default export or a class that can be constructed.

Optional `retry` controls re-attempts if the import fails:

- `retries` – number of additional attempts after the first (default 0)
- `backoffMs` – initial delay before retrying (default 0)
- `factor` – exponential backoff multiplier (default 2)

## Strict Dependency Type Checking

The decorators support constructor parameter type checking via tuple inference. For full type safety, declare your dependencies as a readonly tuple:

```ts
@Injectable(() => [Logger, Metrics] as const)
class AppService {
  constructor(
    private logger: Logger,
    private metrics: Metrics,
  ) {}
}
```

### Ergonomic tuple inference with `deps(...)`

Instead of writing `as const`, you can use the zero-cost helper `deps(...)` to preserve tuple types:

```ts
import { Injectable, deps } from "alloy-di/runtime";

@Injectable(deps(Logger, Metrics))
class AppService {
  constructor(
    private logger: Logger,
    private metrics: Metrics,
  ) {}
}
```

This works the same for singletons:

```ts
import { Singleton, deps } from "alloy-di/runtime";

@Singleton(deps(Logger))
class LoggingDashboard {
  constructor(private logger: Logger) {}
}
```

### Important limitation of TypeScript decorators

TypeScript does not always type-check the decorated class against the decorator's parameter type in decorator position. That means some mismatches may not be surfaced directly by `@Injectable(...)`/`@Singleton(...)` on the class definition.

To guarantee compile-time enforcement without any runtime cost, use the helper `assertDeps(...)` alongside your class:

```ts
import { Injectable, deps, assertDeps } from "alloy-di/runtime";

class Dep {}
class Wrong {}

@Injectable(deps(Dep))
class UsesWrong {
  constructor(private readonly _: Wrong) {}
}

// Fails at compile time if constructor parameters don't match declared deps
// @ts-expect-error mismatch between declared dependency and constructor
assertDeps(deps(Dep), UsesWrong);
```

#### Quick test snippet (Vitest type test)

You can place a type-only test alongside your suite to ensure constructor/dependency mismatches are caught at compile time:

```ts
// decorators.type.test-d.ts
import { describe, it } from "vitest";
import { Injectable, deps, assertDeps } from "alloy-di/runtime";

describe("Decorator type safety", () => {
  it("assertDeps catches mismatches", () => {
    class Dep {}
    class Wrong {}

    @Injectable(deps(Dep))
    class UsesWrong {
      constructor(_: Wrong) {}
    }

    // Causes a compile-time error if the constructor doesn't match deps
    // @ts-expect-error mismatch between declared dependency and constructor
    assertDeps(deps(Dep), UsesWrong);
  });
});
```

### Lazy dependencies type expectations

When using `Lazy(...)`, the constructor should declare the resolved type, not the `Lazy<...>` wrapper:

```ts
import { Injectable, Lazy, deps, assertDeps } from "alloy-di/runtime";

class LazyDep {}

@Injectable([Lazy(() => Promise.resolve(LazyDep))])
class UsesLazyCorrectly {
  constructor(private dep: LazyDep) {}
}

@Injectable([Lazy(() => Promise.resolve(LazyDep))])
class MismatchedLazyParam {
  constructor(private dep: Lazy<LazyDep>) {}
}

// @ts-expect-error constructor expects LazyDep, not Lazy<LazyDep>
assertDeps(deps(Lazy(() => Promise.resolve(LazyDep))), MismatchedLazyParam);
```

### Circular dependencies in the same file

If two classes in the same file depend on each other, use the function form for `dependencies` to break the cycle at type level and runtime:

```ts
@Injectable(() => [CircularB])
class CircularA {
  constructor(private b: CircularB) {}
}

@Injectable(() => [CircularA])
class CircularB {
  constructor(private a: CircularA) {}
}
```

## Tokens and Providers

Alloy supports injection tokens for non-class values and abstractions. Tokens are provided at runtime and can be declared as dependencies for services.

### `createToken<T>(description?: string): Token<T>`

Creates a unique, typed token.

```ts
import { createToken } from "alloy-di/runtime";

export const ApiBaseUrl = createToken<string>("api-base-url");
```

### `container.provideValue<T>(token: Token<T>, value: T): void`

Registers a concrete value for a token.

```ts
import container from "virtual:alloy-container";
import { ApiBaseUrl } from "./tokens";

container.provideValue(ApiBaseUrl, "https://api.example.com");
```

Note: Factories are not supported yet. Provide concrete values via `provideValue`.

### Using tokens in dependencies

Declare tokens in the `dependencies` tuple; the constructor receives the resolved value type.

```ts
import { Injectable, deps } from "alloy-di/runtime";
import { ApiBaseUrl } from "./tokens";

@Injectable(deps(ApiBaseUrl))
class HttpClient {
  constructor(private baseUrl: string) {}
}
```

Type mapping: `ResolveDep<Token<V>>` resolves to `V` (the provided value type).

### Provider API

Providers enable registering services and values without decorators, and they are auto-applied by the generated container when configured via plugin options or ingested from manifests.

- `defineProviders(defs)`: Identity helper for provider blocks.
- `asValue(token, value)`: Bind a token to a concrete value.
- `asClass(Class, { lifecycle, deps })`: Register a class with explicit lifecycle and optional dependencies.
- `asLazyClass(importer, { lifecycle, deps, label })`: Define a lazily imported class; declare deps against its placeholder and optional display `label`.
- `applyProviders(container, defs)`: Apply one or more provider blocks to a container.

Example (library-side provider module):

```ts
// src/providers.ts
import {
  defineProviders,
  asValue,
  asClass,
  asLazyClass,
  lifecycle,
  deps,
} from "alloy-di/runtime";
import { ApiBaseUrl } from "./tokens";
import { Helper } from "./helper";

class RealLazyProcessor {}
const LazyProcessor = asLazyClass(async () => RealLazyProcessor, {
  lifecycle: lifecycle.singleton(),
  deps: deps(ApiBaseUrl),
  label: "LazyProcessor",
});

export default defineProviders({
  values: [asValue(ApiBaseUrl, "https://internal.example/api")],
  services: [asClass(Helper, { lifecycle: lifecycle.transient() })],
  lazyServices: [LazyProcessor],
});
```

Consumer app configuration:

```ts
// vite.config.ts
import alloy from "alloy-di/vite";
export default {
  plugins: [
    alloy({
      providers: ["src/providers.ts"],
      manifests: ["node_modules/@scope/lib/dist/alloy.manifest.mjs"],
    }),
  ],
};
```

The generated `virtual:alloy-container` imports provider modules and applies them after writing decorator-derived registrations. If both a local decorated class and a manifest-provided class share the same name, the plugin throws a helpful duplicate-registration error to avoid ambiguous DI keys.

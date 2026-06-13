# Technical Design: Factory Providers

## Motivation

Alloy's static discovery handles decorated classes, and the provider system
(`asValue` / `asClass` / `asLazyClass`) handles classes and values that live
outside the decorator world. **Factory Providers** fill the remaining gap: a
dependency whose construction requires arbitrary runtime logic — reading
`window` config, composing a third-party client, branching on the environment.

A factory binds a function to a `Token`, runs it at resolution time, and
participates in Alloy's existing lifecycles (`singleton` and `transient`).

## Design Principles

- **Consistent with the provider system.** Factories are declared the same way
  every other non-decorated binding is: an `asFactory(...)` helper aggregated in
  `defineProviders({...})` and applied with `applyProviders`. The declarative
  form is primary; an imperative escape hatch exists for dynamic cases.
- **Token-keyed, slotting into existing resolution.** Factories resolve through
  the same path as value providers (`resolveTokenLike`), keyed by `token.id`.
- **Honest about build-time opacity.** A factory body is opaque to the static
  scanner. This is an intentional runtime escape hatch, and the design says so
  rather than pretending the graph stays fully static.

## Proposed API

### Declarative registration (primary)

`asFactory` mirrors `asClass`: a token, a factory function, and a lifecycle.
Factories are collected under a new `factories` field on `ProviderDefinitions`,
consistent with `values`, `services`, and `lazyServices`:

```ts
import {
  defineProviders,
  asFactory,
  asValue,
  lifecycle,
  createToken,
} from "alloy-di/runtime";

export const ApiClientToken = createToken<ApiClient>("api-client");

export const infraProviders = defineProviders({
  values: [asValue(ConfigToken, loadConfig())],
  factories: [
    asFactory(
      ApiClientToken,
      (c) => new ApiClient({ endpoint: c.getToken(ConfigToken).apiEndpoint }),
      { lifecycle: lifecycle.singleton() },
    ),
  ],
});
```

```ts
import container from "virtual:alloy-container";
import { applyProviders } from "alloy-di/runtime";
import { infraProviders } from "./providers";

applyProviders(container, infraProviders);
```

`lifecycle.singleton()` / `lifecycle.transient()` already exist and return the
`ServiceScope` values the rest of the system uses — factories reuse them rather
than introducing bare `'singleton' | 'transient'` literals.

### Imperative registration (escape hatch)

For cases where a factory must be registered dynamically (not statically
declarable), a thin imperative method backs the same machinery:

```ts
container.provideFactory(ApiClientToken, (c) => new ApiClient(/* … */), {
  lifecycle: lifecycle.singleton(),
});
```

`asFactory` is the recommended default; `provideFactory` is what it calls under
the hood.

## Core Building Blocks

### 1. Lifecycles

- **`singleton()` (default)** — executed once; the result is cached on the
  container and returned for every subsequent request.
- **`transient()`** — re-executed on every request.

### 2. Async support

Factory functions may be `async`. The container awaits the result before
injecting it into dependents. In-flight singleton factories are coalesced (one
execution under concurrent requests), mirroring the existing
`pendingSingletons` behaviour for classes.

### 3. Dependency access

The factory receives the `Container` as its first argument and can resolve its
own dependencies, participating in the graph:

```ts
asFactory(ServiceToken, async (c) => new Service(await c.get(Config)), {
  lifecycle: lifecycle.singleton(),
});
```

## Implementation Details

### Internal storage

The container manages factory descriptors and their cached instances, keyed by
token id (the same key space as `valueProviders`):

```ts
interface FactoryDescriptor<T> {
  fn: (container: Container) => T | Promise<T>;
  lifecycle: ServiceScope;
  cache?: T;
  pending?: Promise<T>;
}

private readonly factoryRegistry = new Map<symbol, FactoryDescriptor<unknown>>();
```

### Resolution pipeline

Factories integrate at the **token** resolution site, not the constructor site.
This is a deliberate, contained change with one consequence worth stating:

> `resolveTokenLike` is **synchronous** today and returns `unknown`. Adding
> async factories makes it return `unknown | Promise<unknown>`. Its sole caller,
> `resolveParam`, already runs inside `Promise.all`, so awaiting the result
> requires no caller change — but the method's signature does change, and value
> providers must keep resolving synchronously (no needless microtask).

Resolution order within `resolveTokenLike`:

1. **Value provider present** → return it synchronously (unchanged behaviour).
2. **Factory present**:
   - _Singleton_: return `cache` if set; else `await pending` if in flight;
     else execute `fn`, store `pending`, cache the result, clear `pending`.
   - _Transient_: execute `fn` and return the result.
3. **Neither** → throw the existing "No provider registered for token" error.

## Relationship with Hierarchical Scopes

This design is **self-contained**: full caching and lifecycle management work on
the root container with no dependency on the scopes package.

If the optional [scopes](./scopes.md) feature is present, a child scope may
choose to _execute_ a root-registered factory and cache its result in the scope
(a request-scoped factory), reusing the `ResolutionContext` seam. The core
factory logic stays scope-agnostic; scopes layer on top.

## Stability and Validation

Factory providers are a runtime escape hatch, with the trade-offs that implies:

- **Type safety** stays strong via `Token<T>` — the factory's return type is
  checked against the token's type at the `asFactory` call site.
- **Build-time validation is limited.** The factory body is opaque to the
  scanner, so the dependency graph cannot see what a factory resolves
  internally. To keep the static graph honest, the visualizer renders these as
  distinct **Factory Nodes**, visually separating them from auto-discovered
  classes whose edges _are_ statically known.

## Implementation Plan

1. Add `asFactory` and the `factories` field to the provider types in
   `providers.ts`; thread them through `applyProviders`.
2. Add `provideFactory` and the `factoryRegistry` to `Container`.
3. Make `resolveTokenLike` async-capable while preserving the synchronous
   value-provider path; add singleton caching + in-flight coalescing for
   factories.
4. Render Factory Nodes in the visualizer.
5. Tests: singleton caching, transient re-execution, async + concurrent
   coalescing, dependency access, and token-not-found errors.

# Hierarchical Scopes (Custom Lifecycles)

In large-scale applications, objects often have lifecycles that are more granular than a global `singleton` but longer-lived than a `transient` instantiation. Common examples include:

- **Web Requests**: Services that should be unique to a single HTTP request and disposed of at the end of it.
- **User Sessions**: Data cached for the duration of a logged-in user session.
- **UI Workflows**: State that lives while a specific modal or multi-step wizard is active.

Alloy's core runtime provides `singleton` and `transient`. Hierarchical scopes allow you to define and validate **custom, application-defined lifecycles** on top of those two.

## The Lifecycle Lattice

Every lifecycle has a position in a hierarchy from longest-lived to shortest-lived:

```
singleton  (root — implicit, always present)
   ▼
 session   (custom scope)
   ▼
 request   (custom scope)
   ▼
transient  (leaf — implicit, never cached)
```

- **`singleton`** is the implicit **root**: it always bubbles up to and caches on the root `Container`.
- **`transient`** is the implicit **leaf**: it is never cached and is always created fresh within whichever context started the resolution.
- **Custom scopes** (e.g. `session`, `request`) sit between the two, ordered by the parent relationships declared in your plugin configuration.

## Declaring the Hierarchy

You declare your custom scopes and their parent relationships once in your `vite.config.ts` (or Rollup config) options:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { alloy } from "alloy-di/vite";

export default defineConfig({
  plugins: [
    alloy({
      scopes: {
        session: {}, // parent defaults to "singleton"
        request: { parent: "session" },
      },
    }),
  ],
});
```

`singleton` is the implicit root, and `transient` is the implicit leaf, so neither needs to be declared. `parent` defaults to `"singleton"` when omitted, so a top-level scope can be declared as `session: {}`.

This single source of truth drives:

1. **Type Generation**: Automatically augments `AlloyScopes` so your custom scopes type-check at build time.
2. **Build-time Validation**: Validates the dependency graph for stability violations (e.g., a singleton depending on a session).
3. **Runtime Registration**: Registers the parent hierarchy with the container to prevent runtime drift.

## Decorating Services

To assign a service to a custom scope, pass the scope name as a string parameter to `@Injectable`:

```typescript
import { Injectable, deps } from "alloy-di/runtime";

@Injectable("session")
export class UserSession {
  constructor() {}
}

@Injectable(deps(UserSession), "request")
export class RequestLogger {
  constructor(private session: UserSession) {}
}
```

### Type Safety for Scope Names

To ensure you don't make typos like `@Injectable("sesion")`, the build plugin automatically generates a module augmentation in a dedicated declaration file (`alloy-scopes.d.ts`, emitted alongside `alloy-container.d.ts` in your [`containerDeclarationDir`](/config/vite-plugin#containerdeclarationdir)):

```typescript
// GENERATED — do not edit
declare module "alloy-di/runtime" {
  interface AlloyScopes {
    session: true;
    request: true;
  }
}
```

This makes custom scope strings fully type-checked. If you declare a scope that isn't configured in `vite.config.ts`, TypeScript will report a compiler error, and the build plugin will fail with an error.

## Managing Scopes at Runtime

The runtime API for scopes is opt-in and lives under the `alloy-di/scopes` subpath. It is completely tree-shaken from your bundle if never imported.

```typescript
import { createScope } from "alloy-di/scopes";
import container from "virtual:alloy-container";
import { UserSession } from "./user-session";
import { RequestLogger } from "./request-logger";

// 1. Create a session scope as a child of the root container
const sessionScope = createScope(container, "session");

// 2. Create a request scope as a child of the session scope
const requestScope = sessionScope.createScope("request");

// 3. Resolve services
//    - RequestLogger will be instantiated and cached in requestScope
//    - UserSession will bubble up and be cached in sessionScope
const logger = await requestScope.get(RequestLogger);
```

### Hierarchical Resolution (Bubbling)

When a service is requested from a `Scope` context:

1. **Match**: If the service's declared scope matches the current scope's name, it is resolved and cached here.
2. **Delegate**: Otherwise, it bubbles the request up to the parent context (and parent's parent, etc.) until a matching scope is found.
3. **Root**: `singleton` services always resolve and cache at the root `Container`.
4. **Leaf**: `transient` services are always created fresh in the originating context and never cached.

### Value Providers

Value providers registered on a scope are visible to that scope and its descendants via the same bubbling rules:

```typescript
const sessionScope = createScope(container, "session");
sessionScope.provideValue(UserToken, currentUser);

const requestScope = sessionScope.createScope("request");
// Bubbles up to sessionScope to resolve UserToken
const token = requestScope.getToken(UserToken);
```

## Build-time Scope Stability Validation

A **Scope Stability Violation** occurs when a longer-lived service depends on a shorter-lived service — e.g. a `singleton` injecting a `request`-scoped service.

When this happens, the shorter-lived object is captured and leaks: it stays alive as long as its host, and every request after the first silently reuses stale state.

Because Alloy builds the full dependency graph statically, the plugin validates the lattice at build time:

> **A service may only depend on services in its own scope or an ancestor (longer-lived) scope.**

This base rule applies to the built-in lifecycles on every build: a `singleton` (or any longer-lived service) may never depend on a `transient`.

Using the hierarchy `singleton ▸ session ▸ request ▸ transient`:

- **Safe** (✅): `request` → `session` → `singleton` (depending on an equal- or longer-lived scope is safe).
- **Safe** (✅): `transient` → any scope (the leaf lives no longer than whatever consumes it, so it may depend on anything).
- **Unsafe** (❌): `singleton` → `request` (the short-lived dependency would be captured by the singleton). **Build error.**
- **Unsafe** (❌): `singleton` → `transient` (a transient injected into a singleton silently becomes a singleton, leaking state). **Build error.**

If any stability violation is detected, Alloy aborts the build and reports the exact offending edge with actionable feedback.

## Scope Disposal Lifecycle

Scopes make disposal a first-class citizen.

- Services can implement standard cleanup hooks: `Symbol.asyncDispose`, `Symbol.dispose`, or an `alloyOnDestroy()` method.
- When `scope.dispose()` is called:
  1. All **child scopes** are disposed first recursively.
  2. All instantiated services in the scope are disposed in **reverse instantiation order** (dependents are torn down before their dependencies).
- `dispose()` catches individual disposer errors, ensuring the rest of the teardown completes, and throws an `AggregateError` at the end if multiple failures occurred.
- `Scope` natively implements `Symbol.asyncDispose`, meaning you can manage scope lifecycles using the `await using` syntax:

```typescript
{
  await using requestScope = sessionScope.createScope("request");
  const logger = await requestScope.get(RequestLogger);
  // requestScope is disposed automatically when exiting the block scope
}
```

## Runtime Drift Protection

To prevent runtime scope trees from drifting from your build-time declared configuration (e.g., someone trying to instantiate `request` directly under `singleton`, skipping `session`), the runtime automatically validates parent scope names during creation.

If you attempt to construct an invalid tree:

```typescript
// Throws Error: request is declared with parent 'session', but was constructed with parent 'singleton'
const requestScope = createScope(container, "request");
```

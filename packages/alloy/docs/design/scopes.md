# Technical Design: Hierarchical Scopes

## Motivation

In large-scale TypeScript applications, objects often have lifecycles that are
more granular than a global `singleton` but longer-lived than a `transient`
instantiation. Common examples include:

- **Web Requests**: Services that should be unique to a single HTTP request.
- **User Sessions**: Data cached for the duration of a logged-in session.
- **UI Workflows**: State that lives while a specific modal or multi-step wizard
  is active.

Alloy's core runtime provides `singleton` and `transient`. This document
proposes a **hierarchical scope system** that adds custom, application-defined
lifecycles on top of those two.

The design is governed by Alloy's core principles:

1. **The graph is known at build time.** Scopes are not just a runtime cache
   strategy — they are a statically validated contract. The plugin rejects
   captive-dependency bugs _before_ the app runs. This is the headline feature,
   not a side effect.
2. **Zero-cost core.** Applications that never use custom scopes pay nothing.
   The feature ships **inside the core `alloy-di` package** as an opt-in subpath
   export (`alloy-di/scopes`) — not a separate `@alloy-di/scopes` npm package —
   that tree-shakes away entirely when unimported. The core `Container` gains
   only a small, already-inert seam. See
   [Packaging and Zero-Cost Inclusion](#packaging-and-zero-cost-inclusion).
3. **API consistency.** Scopes reuse the existing decorator overloads, the
   existing provider system, and the existing declared-module convention rather
   than inventing parallel surfaces.

## Core Concepts

### 1. Scope Instance

A `Scope` is an object that holds its own cache of instantiated services. Every
`Scope` has a `parent` (either the root `Container` or another `Scope`),
forming a tree.

### 2. Resolution Context

Resolution is no longer implicitly global. When a service is requested, it is
resolved within a **Resolution Context** — the active `Scope` instance (or the
root `Container`, which is itself the trivial root context).

### 3. The Lifecycle Lattice

Every lifecycle has a position from longest-lived to shortest-lived:

```
singleton  (root — implicit, always present)
   ▼
 <custom scopes, e.g. session ▼ request>
   ▼
transient  (leaf — implicit, never cached)
```

- `singleton` is the implicit **root**: it always bubbles up to and caches on
  the root `Container`.
- `transient` is the implicit **leaf**: it is never cached and is always
  created fresh within whichever context started the resolution.
- Custom scopes (`session`, `request`, …) sit between the two, ordered by the
  parent relationships declared in the plugin config (see
  [Declaring the Hierarchy](#declaring-the-hierarchy)).

### 4. Hierarchical Resolution (Bubbling)

When a service is requested from a scope:

1. **Match** — If the service's declared scope equals the current scope's name,
   resolve and cache it here.
2. **Delegate** — Otherwise, bubble the request up to the parent context until a
   matching scope is found.
3. **Root** — `singleton` services always resolve at the root `Container`.
4. **Leaf** — `transient` services are created fresh in the originating context
   and never cached.

## Proposed API

### Decorating Services

Custom scopes reuse the **existing** `@Injectable` string-scope overload — there
is no new object-options form. Today `@Injectable` already accepts a scope
string and an optional deps tuple:

```ts
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

This is the same shape as `@Injectable('singleton')` and
`@Injectable(deps(Logger), 'singleton')` that the library already supports. No
new decorator signatures are introduced.

#### Making custom scope names type-safe (generated, not hand-authored)

`ServiceScope` is currently a closed union of `'singleton' | 'transient'`. To
let `@Injectable('session')` type-check (and to reject typos like
`@Injectable('sesion')`), the scope name set becomes **augmentable** — and the
augmentation is **emitted by the plugin**, exactly like the generated
`virtual:alloy-container` declaration today.

Consumers never write or open a `.d.ts` file. The runtime ships a small
augmentable seam:

```ts
// alloy-di/runtime (library)
export interface AlloyScopes {
  singleton: true;
  transient: true;
}
export type ServiceScope = keyof AlloyScopes;
```

The plugin then emits the custom names into the same generated declaration file
it already produces under `containerDeclarationDir` (default `./src`):

```ts
// GENERATED — do not edit
declare module "alloy-di/runtime" {
  interface AlloyScopes {
    session: true;
    request: true;
  }
}
```

The result is the same developer-experience loop as adding a service:

1. You write `@Injectable('session')`. `ServiceScope` does not yet include
   `'session'`, so TypeScript reports an error.
2. Container generation runs (as it already does on dev/build), reads the scope
   from the [hierarchy declaration](#declaring-the-hierarchy), and emits the
   name into the generated `.d.ts`.
3. The error clears — just as a newly added service appears in
   `serviceIdentifiers`.

This gives autocomplete and compile-time validation on every `@Injectable(...)`
call **at zero runtime cost** — the names exist only in generated types. The
existing `ServiceScope` value object continues to carry the two built-in
lifecycles for internal use; only the _type_ becomes open.

> **Why the names come from config, not pure source discovery.** Scope _names_
> could in principle be harvested from `@Injectable` usage, but the build also
> needs each scope's _parent_ to validate stability and emit bubbling metadata,
> and parent ordering cannot be inferred from usage. The
> [`scopes` plugin option](#declaring-the-hierarchy) is therefore the single
> source of truth for both names and ordering; the generator derives the
> `AlloyScopes` augmentation from it.

> **Default behaviour for unknown scopes.** A service that declares a scope name
> absent from the `scopes` config produces a build error (see validation below)
> — and, because the name was never generated, a TypeScript error at the
> decorator call as well. At runtime, the core `Container` running _without_ the
> scopes package treats any non-`singleton` scope as `transient`, matching
> today's `getServiceMetadata` fallback, so custom scopes degrade safely rather
> than throwing.

### Declaring the Hierarchy

Type augmentation registers scope _names_; the build still needs their _order_
to validate stability and to emit bubbling metadata. The parent relationships
are declared once, in the plugin options, alongside the rest of Alloy's
build-time configuration:

```ts
// vite.config.ts
import { alloy } from "alloy-di/vite";

export default {
  plugins: [
    alloy({
      scopes: {
        session: { parent: "singleton" },
        request: { parent: "session" },
      },
    }),
  ],
};
```

`singleton` is the implicit root and `transient` the implicit leaf, so neither
needs to be declared. This single source of truth drives both build-time
validation and the scope metadata baked into the generated container.

### Managing Scopes at Runtime

The runtime glue lives in the opt-in `alloy-di/scopes` subpath. It wraps the
container exported by the generated virtual module:

```ts
import { createScope } from "alloy-di/scopes";
import container, { serviceIdentifiers } from "virtual:alloy-container";

// 1. Create a session scope as a child of the root container
const sessionScope = createScope(container, "session");
sessionScope.provideValue(UserToken, currentUser);

// 2. Create a request scope as a child of the session
const requestScope = sessionScope.createScope("request");

// 3. Resolve services
//    RequestLogger caches in requestScope
//    UserSession caches in sessionScope (resolved via bubbling)
const logger = await requestScope.get(RequestLogger);

// 4. Cleanup (reverse instantiation order, innermost first)
await requestScope.dispose();
await sessionScope.dispose();
```

`Scope` mirrors the relevant slice of the `Container` surface (`get`,
`getByIdentifier`, `provideValue`, `getToken`) so callers can treat a scope as a
drop-in resolution context. Value providers registered on a scope are visible to
that scope and its descendants via the same bubbling rules.

## Build-Time Validation: Scope Stability

This is the reason scopes belong in Alloy specifically rather than a generic DI
container.

A **Scope Stability Violation** is a long-lived service depending on a
shorter-lived one — e.g. a `singleton` that injects a `request`-scoped service.
The short-lived object gets "captured" and leaks: it stays alive as long as its
host, and every request after the first silently reuses stale state. In most DI
frameworks this is a runtime landmine.

Because Alloy already builds the full dependency graph statically, the plugin
validates the lattice at build time:

> **A service may only depend on services in its own scope or an ancestor
> (longer-lived) scope.**

Using the hierarchy `singleton ▸ session ▸ request ▸ transient`:

- ✅ `request` → `session` → `singleton` — depending on an equal- or
  longer-lived scope is always safe.
- ✅ `transient` → any scope — the leaf lives no longer than whatever consumes
  it, so it may depend on anything.
- ❌ `singleton` → `request` (or any shorter-lived scope, **including
  `transient`**) — the short-lived dependency is captured by its longer-lived
  host and leaks. **Build error.**

Transient is the one asymmetric case: it may _depend on_ anything, but nothing
longer-lived may _cache_ it — a transient injected into a singleton silently
becomes a de-facto singleton, which is exactly the captive dependency the rule
exists to catch.

The plugin reports violations with the same diagnostic quality as the existing
circular-dependency detection: the offending edge and the full resolution path.

## Disposal Lifecycle

Scopes make disposal a first-class concern, and it is intentionally designed as
a **library-wide lifecycle primitive** rather than a scopes-only detail — the
root `Container` can adopt the same hook for singleton teardown in tests and on
shutdown.

- Services may implement `Symbol.asyncDispose` / `Symbol.dispose`, or an
  `alloyOnDestroy()` hook.
- Each `Scope` records instantiation order and disposes in **reverse** order so
  dependents are torn down before their dependencies.
- `dispose()` is async to accommodate async teardown (closing connections,
  flushing buffers) and to compose with `Symbol.asyncDispose`.

## Core Changes: The Resolution Context Seam

This is the most invasive part of the work and is called out honestly here.

Today the singleton cache and the resolution methods (`resolve`,
`resolveSingleton`, `createInstance`, `resolveParam`) live on, and are private
to, the `Container` instance. Supporting scopes requires threading a
`ResolutionContext` through all of them:

```ts
interface ResolutionContext {
  /** Scope name this context resolves at (root === "singleton"). */
  readonly scopeName: ServiceScope;
  /** Look up an already-cached instance for a target in this context. */
  getCached(target: Constructor): unknown | undefined;
  /** Cache an instance at this context. */
  setCached(target: Constructor, instance: unknown): void;
  /** Parent context, or null at the root. */
  readonly parent: ResolutionContext | null;
}
```

- The core `Container` implements the **root** `ResolutionContext` (its existing
  `singletons` map). With no scopes package loaded, the context is always the
  root and behaviour is byte-for-byte what it is today.
- `alloy-di/scopes` provides child `ResolutionContext` implementations and the
  bubbling logic.
- The refactor is mechanical but wide: every private resolution method gains a
  context parameter. The payoff is that scopes need no fork of the resolution
  engine — they only supply caches and a parent chain.

This is a larger change than "add a package," and the implementation plan
sequences it first for that reason.

## Relationship with Other Features

- **[Factory Providers](./factory-providers.md)** — A factory registered on the
  root container can be _executed_ by a child scope and its result cached there
  (a "request-scoped factory"), reusing the `ResolutionContext` seam below. The
  core factory logic stays scope-agnostic.
- **[Interceptors](./interceptors.md)** — When a service is both intercepted and
  scoped, the scope caches the generated wrapper subclass (not the raw class),
  so the two features compose without special handling.
- **Visualizer** — Scope membership is already known statically. The dependency
  graph should color/group nodes by scope and render stability violations as
  highlighted edges, so the lattice is visible at a glance. This composes with
  the Factory Nodes and instrumented-service badges the other two features add.

## Packaging and Zero-Cost Inclusion

Scopes live **in the core `alloy-di` package**, exposed as a new subpath export
`alloy-di/scopes`. This is deliberately _not_ a separate `@alloy-di/scopes`
package: there is no extra install, no version-skew between core and scopes, and
the feature follows the exact convention already used for `alloy-di/runtime`,
`alloy-di/vite`, and `alloy-di/test`.

"Opt-in" is achieved purely through module reachability, not a runtime flag:

- **Separate entry point.** `src/scopes.ts` becomes a new rolldown input
  (alongside `runtime`, `vite`, `rollup`, `test`) and a new `exports["./scopes"]`
  entry. Code is only reachable if the consumer writes
  `import { createScope } from "alloy-di/scopes"`.
- **One-way dependency.** The scopes module imports the core `Container`; the
  core **never** imports the scopes module. An app that never imports
  `alloy-di/scopes` therefore has no path to any scope code, and a bundler drops
  all of it.
- **`sideEffects: false`.** The package currently declares no `sideEffects`
  field, so bundlers conservatively assume every module has side effects and
  retain them. Adding `"sideEffects": false` (the runtime is pure — registration
  happens through explicit calls) is a prerequisite for the unused subpath to be
  fully eliminated rather than merely unreferenced.
- **The seam is inert, not absent.** The core `Container` always carries the
  `ResolutionContext` parameter, but at the root it resolves to the container's
  own existing `singletons` map. With no scopes imported there are no child
  contexts, no bubbling, and no behavioural or measurable overhead versus today
  — the seam compiles to the same hot path.

Net effect: a consumer who never touches scopes ships byte-for-byte what they
ship now (modulo the `sideEffects` win, which only helps); a consumer who opts
in pays only for the scope code they actually import.

## Implementation Plan

1. **Core seam.** Refactor `Container` resolution to flow through a
   `ResolutionContext`, with the container as the root implementation. No
   behaviour change; pure refactor, fully covered by existing tests.
2. **Augmentable scope type.** Introduce the `AlloyScopes` interface and open
   the `ServiceScope` type while preserving the built-in value object. No
   consumer-authored declarations.
3. **Build-time hierarchy + validation.** Add the `scopes` plugin option; emit
   the `AlloyScopes` augmentation and scope metadata into the generated
   declaration/container; implement stability validation with actionable
   diagnostics.
4. **`alloy-di/scopes` subpath.** Add `src/scopes.ts` as a rolldown input and an
   `exports["./scopes"]` entry, set `"sideEffects": false`, and implement
   `createScope`, child contexts, bubbling, and the disposal lifecycle.
5. **Visualizer.** Group nodes by scope and surface violations.
6. **Tests.** Hierarchical resolution, bubbling, captive-dependency build
   errors, disposal ordering, and the zero-scope no-op path.

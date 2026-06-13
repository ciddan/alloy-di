# Technical Design: Interceptors and Middleware

## Motivation

Large applications have cross-cutting concerns that should not be hand-wired
into every service:

- **Logging** — record method calls and arguments.
- **Telemetry** — time execution for performance monitoring.
- **Error handling** — standardize how exceptions are caught and reported.
- **Audit** — record sensitive operations.

Interceptors attach these behaviours to services declaratively, without editing
the services themselves.

## Design Principles

Alloy already knows the dependency graph at build time and generates the
container. Interceptors follow the same philosophy: **weave at build time, not
at runtime.** This is a deliberate departure from the obvious "wrap instances in
a `Proxy`" approach, which — as the [Alternatives](#alternatives-considered)
section details — is subtly broken in three ways. Build-time weaving keeps the
runtime minimal, preserves type fidelity, and intercepts calls a proxy cannot.

## Proposed API

### Declaring an interceptor (build time)

Interceptors are configured in the plugin, where the `include` filter runs
against **static** metadata. The filter never ships to the runtime, so it can
use build-only data (file path, class name, scope) freely:

```ts
// vite.config.ts
import { alloy } from "alloy-di/vite";

export default {
  plugins: [
    alloy({
      interceptors: [
        {
          // Build-time filter over static service metadata.
          include: (meta) => meta.filePath.includes("/services/database/"),
          // Module + export implementing the interceptor contract.
          use: {
            module: "./src/interceptors/timing",
            export: "TimingInterceptor",
          },
        },
      ],
    }),
  ],
};
```

For each service the filter matches, the plugin generates a typed wrapper and
registers it in the container in place of the raw class. Services that match no
interceptor are emitted exactly as today — **zero cost when unused.**

### The interceptor contract

An interceptor is a small object with an `intercept` method. The chain is a
middleware pipeline: each interceptor receives the call `context` and a `next`
function and returns whatever `next` returns.

```ts
interface InterceptionContext {
  target: Constructor; // the service class
  instance: unknown; // the service instance
  method: string; // method name being called
  args: unknown[]; // arguments passed
}

interface Interceptor {
  intercept(ctx: InterceptionContext, next: () => unknown): unknown;
}
```

```ts
// src/interceptors/timing.ts
export const TimingInterceptor: Interceptor = {
  intercept(ctx, next) {
    const start = performance.now();
    try {
      return next();
    } finally {
      console.log(
        `${ctx.target.name}.${ctx.method} took ${performance.now() - start}ms`,
      );
    }
  },
};
```

> **Return-type fidelity (the async rule).** The middleware contract is
> **sync-transparent**: an interceptor that returns `next()` directly preserves
> the wrapped method's exact return type — a `number`-returning method stays
> `number`, not `Promise<number>`. Because the wrapper is generated, this is
> enforced statically:
>
> - The generated wrapper mirrors each source method's signature, including its
>   sync/async nature (the scanner reads the `async` modifier and return type).
> - An interceptor that performs `await` only composes with `async` methods. The
>   plugin emits a **build error** if an async-only interceptor is woven into a
>   sync method, instead of silently turning `T` into `Promise<T>` the way a
>   runtime proxy does.

## Implementation Strategy: Build-Time Woven Wrappers

### 1. Discovery

The scanner already parses each class declaration via the TypeScript compiler
API to extract constructor dependencies. It gains a small additional pass to
collect each service's **public method names and signatures** (own methods
first; inherited methods are a documented follow-up).

### 2. Wrapper generation

For a matched service, the plugin generates a subclass that overrides each
public method to run the interceptor chain around a `super` call:

```ts
// GENERATED
import { DatabaseService } from "../services/database/database-service";
import { TimingInterceptor } from "../interceptors/timing";

export class DatabaseService__Intercepted extends DatabaseService {
  query(
    ...args: Parameters<DatabaseService["query"]>
  ): ReturnType<DatabaseService["query"]> {
    const ctx = {
      target: DatabaseService,
      instance: this,
      method: "query",
      args,
    };
    return runChain([TimingInterceptor], ctx, () => super.query(...args));
  }
}
```

The container is then generated to construct `DatabaseService__Intercepted`
(with the same resolved dependencies) wherever `DatabaseService` is requested.

### 3. The chain

`runChain` folds the interceptors into a `next` pipeline and returns the inner
result directly, so sync calls stay sync:

```ts
function runChain(interceptors, ctx, terminal) {
  return interceptors.reduceRight(
    (next, interceptor) => () => interceptor.intercept(ctx, next),
    terminal,
  )();
}
```

## Why a Subclass Beats a Proxy

Generating a **subclass** rather than a runtime `Proxy` is what makes
interception correct:

- **Internal calls are intercepted.** When `service.doWork()` internally calls
  `this.query()`, dynamic dispatch routes `this.query` to the overridden method
  — because the instance _is_ the subclass. A `Proxy` only traps access through
  the proxy reference, so internal `this` calls slip past it entirely. This is
  the difference between "telemetry on every call" working and silently missing
  most calls.
- **Types are real, not asserted.** The wrapper is ordinary generated TypeScript
  the compiler checks, using `Parameters<…>` / `ReturnType<…>` off the original
  method. A proxy's `get` trap is untyped and forces unsafe casts.

## Alternatives Considered

### Runtime `Proxy` (rejected)

The intuitive implementation wraps each instance in a `Proxy` whose `get` trap
returns method functions wrapped in the interceptor chain. It was rejected
because it is wrong in three ways that build-time weaving avoids:

1. **Silent async coercion.** A middleware chain built from `async (ctx, next)`
   functions always returns a `Promise`, so an intercepted synchronous
   `compute(): number` becomes `Promise<number>` at runtime while its type still
   says `number`. Invisible to the type system — the worst failure mode for a
   library that sells compile-time safety.
2. **Internal calls bypass interception.** Proxies only trap external property
   access; `this.method()` calls inside the class never hit the trap, so
   "intercept every call" quietly does not.
3. **Build-time data leaks into the runtime.** A runtime `include` filter forces
   `filePath` and other build-only metadata into the shipped bundle, against the
   minimal-runtime principle. Build-time weaving runs the filter during codegen;
   nothing about it reaches the client.

Build-time weaving fixes all three, at the cost of a codegen pass — which Alloy
already has.

## Relationship with Other Features

- **[Hierarchical Scopes](./scopes.md)** — Interception happens at construction:
  the container builds the wrapper subclass instead of the raw class. Whatever
  context caches the instance (root or a child scope) therefore caches the
  woven wrapper, so scoping and interception compose with no special handling.
- **[Factory Providers](./factory-providers.md)** — Factory-produced values are
  built by an opaque function, not constructed by Alloy, so they are **not**
  woven. Interception targets discovered/decorated classes only; cross-cutting
  behaviour for a factory result belongs inside the factory.
- **Visualizer** — Instrumented services are badged in the dependency graph (see
  below), composing with scope grouping and Factory Nodes.

## Limitations

- **Private methods / properties.** Cross-cutting behaviour applies to public
  methods only; private methods and property access are out of scope (property
  interception may be revisited later).
- **Inherited methods.** The first iteration weaves a class's own public
  methods; intercepting inherited methods is a documented follow-up.
- **Final classes / private constructors.** Subclass generation requires an
  extendable class; services that cannot be subclassed are reported as an
  interceptor-incompatibility build error rather than silently skipped.

## Implementation Plan

1. Extend the scanner to collect public method names/signatures per service.
2. Add the `interceptors` plugin option and the build-time `include` matcher
   over static metadata.
3. Generate wrapper subclasses + `runChain`, and register wrappers in the
   container in place of matched classes.
4. Enforce the async rule (build error on async interceptor × sync method) and
   the non-extendable-class error.
5. Badge instrumented nodes in the visualizer.
6. Tests: chain ordering, sync-transparency, internal-call interception,
   error/`finally` semantics, and the zero-match no-op path.

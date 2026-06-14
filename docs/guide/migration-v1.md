# Migrating from v1

`alloy-di@2.0` is a small, mostly mechanical upgrade; the three breaking changes below each list their exact fix. It also adds [webpack and Rspack support](/config/bundler-plugins) and [Jest and `node:test` adapters](/guide/testing) — neither needs any changes to existing code.

## 1. A singleton can no longer depend on a transient

**What changed.** Alloy now always enforces scope stability: a service may depend only on its own scope or a longer-lived one. For the built-in lifecycles that makes a `singleton` depending on a `transient` a build error. (For custom scopes, "longer-lived" is the ancestor relationship you declare via each scope's `parent` — see [scopes](/guide/scopes#build-time-scope-stability-validation).) In v1 this was only checked when you configured custom `scopes`; in v2 it applies to every build.

**Why?** The transient is constructed once, when the singleton is built, and then captured for the singleton's whole lifetime - it silently behaves like a singleton and leaks stale state. See [scope stability](/guide/scopes#build-time-scope-stability-validation).

**Fix.** Make the dependency at least as long-lived as the service that holds it, or move the holder down to the shorter lifecycle.

```ts
// ❌ v2 build error: singleton captures a transient
@Injectable() // transient (the default)
class RequestId {}

@Singleton(deps(RequestId))
class Cache {
  constructor(private id: RequestId) {}
}
```

```ts
// ✅ option A — make the dependency a singleton too
@Singleton()
class RequestId {}

// ✅ option B — make the holder transient (or a custom scope)
@Injectable(deps(RequestId))
class Cache {
  constructor(private id: RequestId) {}
}
```

The build reports the exact offending edge, so you can find every violation in one pass. If a value genuinely should be created per use inside a long-lived service, inject a [factory](/guide/factory-providers) or a custom [scope](/guide/scopes) instead of a transient.

## 2. Test utilities moved to `@alloy-di/testing`

**What changed.** The `alloy-di/test` entry point was removed, and `alloy-di` no longer depends on a test runner (the `vitest` peer dependency is gone). The test container now lives in a dedicated `@alloy-di/testing` package with thin per-runner adapters.

**Fix.** Install the package and update the import specifier — the API is identical.

```bash
pnpm add -D @alloy-di/testing
```

```ts
// Before (alloy-di 1.x)
import { createTestContainer } from "alloy-di/test";

// After — pick the adapter for your runner
import { createTestContainer } from "@alloy-di/testing/vitest";
// or "@alloy-di/testing/jest" · "@alloy-di/testing/node"
```

See the [Testing guide](/guide/testing) for the full adapter API and `setupAlloyTesting()`.

## 3. Import from the right subpath

**What changed.** `alloy-di` is now a subpath-only package — a bare `import … from "alloy-di"` is unsupported (it never reliably resolved). Import each piece from its documented entry point.

**Fix.**

| You need                                   | Import from         |
| ------------------------------------------ | ------------------- |
| Decorators, tokens, providers, `Container` | `alloy-di/runtime`  |
| The build plugin (Vite)                    | `alloy-di/vite`     |
| The build plugin (webpack)                 | `alloy-di/webpack`  |
| The build plugin (Rspack)                  | `alloy-di/rspack`   |
| The library manifest plugin                | `alloy-di/rollup`   |
| Runtime scopes (`createScope`)             | `alloy-di/scopes`   |
| The declaration generator                  | `alloy-di/generate` |

```ts
// ❌ no bare root entry
import { Injectable } from "alloy-di";

// ✅
import { Injectable } from "alloy-di/runtime";
```

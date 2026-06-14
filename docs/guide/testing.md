# Testing and Mocking with Alloy

This guide covers the testing utilities published in the `@alloy-di/testing`
package, including manual overrides, provider application, factory overrides,
custom scopes, automocking of dependencies, and lazy-loaded services.

`@alloy-di/testing` ships a runner-neutral core plus thin adapters that wire in
your test runner's mock function:

- `@alloy-di/testing/vitest` — wires `vi.fn` (Vitest).
- `@alloy-di/testing/jest` — wires `jest.fn` (`@jest/globals`).
- `@alloy-di/testing/node` — wires `mock.fn()` (`node:test`).
- `@alloy-di/testing` — the runner-neutral core; use it directly only if you
  supply your own `mockFn`.

> [!NOTE]
> The previous entry `alloy-di/test` is **deprecated**. It now re-exports
> `@alloy-di/testing/vitest` and will be removed in the next major release.
> See [Migrating from `alloy-di/test`](#migrating-from-alloy-di-test).

## Prerequisites

- Install `@alloy-di/testing` alongside `alloy-di`.
- Install and configure a supported test runner. For Vitest, the peer range is
  `vitest >=4.0.14 <5.0.0`.

## Module: `@alloy-di/testing/vitest`

The adapter entry provides helpers to build a container tailored for tests. The
Vitest adapter is used throughout this guide; the Jest and `node:test` adapters
expose the identical API.

### `createTestContainer(options?)`

Creates a container instance with optional overrides and automocking. Returns a handle with convenient accessors.

Options:

- `overrides?: { instances?: Array<[Newable, instance]>; tokens?: Array<[Token<T>, T]>; factories?: Array<[Token<T>, FactoryFn<T>, { lifecycle? }?]> }`
- `providers?: ProviderDefinitions | ProviderDefinitions[]` — apply provider blocks to the container.
- `scopes?: Record<string, { parent?: ServiceScope }>` — register a test-only custom scope hierarchy, matching the `alloy({ scopes })` shape.
- `autoMock?: boolean` — enable automocking. The runner adapter supplies the
  underlying `mockFn`; the runner-neutral core requires you to pass one.
- `target?: Newable` — the focal class whose dependency graph will be traversed for automocking.

Returned handle:

- `get<T>(ctor: Newable<T>): Promise<T>` — resolve a class.
- `getToken<T>(token: Token<T>): T` — retrieve a provided token value.
- `provideToken<T>(token: Token<T>, value: T): void` — provide or update a token value.
- `provideFactory<T>(token: Token<T>, factory: FactoryFn<T>, options?: { lifecycle?: ServiceScope }): void` — provide a token factory after construction.
- `overrideFactory<T>(token: Token<T>, factory: FactoryFn<T>, options?: { lifecycle?: ServiceScope }): void` — alias for replacing a token factory after construction.
- `createScope(scopeName: ServiceScope): Scope` — create a child scope under the test container.
- `getMock<T>(ctor: Newable<T>): MockOf<T> | undefined` — get a specific class mock.
- `getMocks<T extends readonly Newable[]>(ctors: T): [...]` — tuple-preserving batch mock retrieval.
- `restore(): void` — restores the DI registry and any patched lazy importers; call this after each test.
- `clearMockSpies(): void` — resets every auto-mock spy using the runner's reset semantics.
- `spyOf<T>(ctor, method): Spy | undefined` — retrieve a single method spy.

### `setupAlloyTesting()`

Each adapter also exports `setupAlloyTesting()`. Call it once per test file (or
in a shared setup file) to register the runner's `afterEach` hook. Containers
created through its returned `createTestContainer` are automatically restored and
cleared after every test, so you don't have to call `restore()` yourself:

```ts
import { setupAlloyTesting } from "@alloy-di/testing/vitest";

const alloyTesting = setupAlloyTesting();

it("works", async () => {
  const test = alloyTesting.createTestContainer({
    autoMock: true,
    target: MyService,
  });
  const svc = await test.get(MyService);
  // ... assertions; no manual restore() needed
});
```

Importing an adapter never registers test hooks on its own — only
`setupAlloyTesting()` does. Containers created with the adapter's top-level
`createTestContainer` are **not** auto-cleaned; call `restore()` yourself.

### `MockOf<T, S>`

A typed mock instance for a class. Its `spies` map contains runner spies for
prototype methods, and fields mirror callable methods for ergonomic usage. The
`S` parameter is the runner's spy type (e.g. Vitest's `Mock`), supplied by the
adapter so spies keep full runner-specific typing.

```ts
export type MockOf<T, S = GenericSpy> = Partial<T> & {
  spies: Record<Extract<MethodKeys<T>, string>, S>;
  __target: Newable<T>;
};
```

## Manual Overrides

You can manually override instances and token values for deterministic tests.

```ts
import { createTestContainer } from "@alloy-di/testing/vitest";
import { defineProviders } from "alloy-di/runtime";
import providers from "./providers";
import { EventTracker } from "./event-tracker";
import { AnalyticsService } from "./analytics-service";
import { LibraryApiBaseUrl } from "./tokens";

const test = createTestContainer({
  providers,
  overrides: {
    instances: [[AnalyticsService, { track: () => undefined }]],
    tokens: [[LibraryApiBaseUrl, "https://test.local/api"]],
  },
});

const tracker = await test.get(EventTracker);
```

## Factory Overrides

Use `overrides.factories` when the production provider is a token-bound factory
or when a test needs to construct a token value lazily. The tuple mirrors
`container.provideFactory`: token, factory function, and optional lifecycle.

```ts
import { createTestContainer } from "@alloy-di/testing/vitest";
import { lifecycle } from "alloy-di/runtime";
import { ApiClientToken } from "./tokens";
import { EventTracker } from "./event-tracker";

const test = createTestContainer({
  providers,
  overrides: {
    factories: [
      [
        ApiClientToken,
        () => new FakeApiClient(),
        { lifecycle: lifecycle.singleton() },
      ],
    ],
  },
});

const tracker = await test.get(EventTracker);
```

Token value overrides still take precedence over factories for the same token,
which is useful when you want to pin a concrete value without removing the
factory registration. Factory overrides are explicit token-keyed overrides;
`autoMock` only mocks class constructor dependencies.

You can also provide or replace a factory after the test container is created:

```ts
const test = createTestContainer({ providers });

test.provideFactory(ApiClientToken, () => new FakeApiClient());
test.overrideFactory(ApiClientToken, () => new OtherFakeClient());
```

## Custom Scopes in Tests

When code under test uses custom lifecycles, pass the same `scopes` block shape
you use in `alloy({ scopes })`. Omitted parents default to `"singleton"`.

```ts
import { createTestContainer } from "@alloy-di/testing/vitest";
import { CurrentUserToken, GreetingToken } from "./tokens";
import { RequestConsumer } from "./request-consumer";

const test = createTestContainer({
  providers,
  scopes: {
    session: {},
    request: { parent: "session" },
  },
  overrides: {
    factories: [
      [
        GreetingToken,
        (ctx) => `hello ${ctx.getToken(CurrentUserToken)}`,
        { lifecycle: "request" },
      ],
    ],
  },
});

const session = test.createScope("session");
const request = session.createScope("request");
request.provideValue(CurrentUserToken, "alice");

const consumer = await request.get(RequestConsumer);
```

Scoped factory overrides cache on the matching test scope and can read
scope-local token values through the factory context. Disposing the scope also
disposes scoped factory results that implement `Symbol.dispose`,
`Symbol.asyncDispose`, or `alloyOnDestroy`.

## Automocking Dependencies

When `autoMock` is enabled and `target` is set, the container automatically creates mocks for the dependency graph of the target.

- Deep graph traversal: walks constructors across multiple levels.
- Lazy services: patches lazy importer to return a surrogate constructor wired with spies, so downstream `container.get` receives a class whose methods are mocked.
- Respect overrides: any constructor present in `overrides.instances` is not auto-mocked.

```ts
const test = createTestContainer({
  providers,
  autoMock: true,
  target: EventTracker,
});

const tracker = await test.get(EventTracker);
tracker.trackButtonClick("cta", "header");

const analyticsMock = test.getMock(AnalyticsService);
expect(analyticsMock?.spies.track).toHaveBeenCalledTimes(1);
```

### Lazy-loaded Services

If a dependency is declared via `Lazy(() => import(...))`, the testing utilities patch the importer to return a surrogate constructor whose prototype methods are spies.

This ensures your test can assert calls on methods of lazy services without loading real implementations.

```ts
import { HeavyProcessor } from "./heavy-processor";

const heavyMock = test.getMock(HeavyProcessor);
expect(heavyMock?.spies.process).toHaveBeenCalledTimes(1);
```

## Registry Utilities

- `snapshotRegistry()`/`restoreRegistry()` — take and restore dependency registry snapshots for advanced scenarios.
- `createToken(description?)` — convenience re-export for creating tokens in tests.

## Snapshotting and Restore

When you create a test container, Alloy takes a snapshot of the global dependency registry before applying providers, overrides, and any automock patches. During `restore()`, the snapshot is reapplied and any patched lazy importers are reset to their original importer functions.

Why this matters:

- Isolation: Prevents cross-test leakage from overrides and mocks.
- Determinism: Ensures each test starts with a clean registry state.
- Lazy safety: Patches to lazy importers are undone, avoiding subtle state drift.

Recommended usage (Vitest):

```ts
import { afterEach } from "vitest";
import { createTestContainer } from "@alloy-di/testing/vitest";

describe("my feature", () => {
  it("works with overrides and mocks", async () => {
    const { get, restore } = createTestContainer({
      autoMock: true,
      target: MyService,
    });
    const svc = await get(MyService);
    // ... assertions
    restore();
  });
});
```

## Example Tests

See `packages/examples/library-internal/src` for examples:

- `alloy-testing-basic.test.ts` — manual overrides (tokens and instances)
- `alloy-testing-automock.test.ts` — immediate dependency automocking
- `alloy-testing-deep-lazy.test.ts` — deep graph + lazy service automocking

## Notes

- Automocking focuses on class dependencies. Tokens are skipped during mock traversal.
- Factory overrides are token-keyed and explicit; `autoMock` does not replace them.
- Test scopes use the same hierarchy shape as plugin scopes: `{ session: {}, request: { parent: "session" } }`.
- `get` returns a Promise because services may be lazy-loaded.
- A supported test runner must be installed for the adapter you import.

## Migrating from `alloy-di/test`

`alloy-di/test` is deprecated and now re-exports `@alloy-di/testing/vitest`,
so existing tests keep working unchanged. To migrate, install `@alloy-di/testing`
and update the import specifier:

```ts
// Before
import { createTestContainer } from "alloy-di/test";

// After
import { createTestContainer } from "@alloy-di/testing/vitest";
```

The API is identical. `alloy-di/test` will be removed in the next major release.

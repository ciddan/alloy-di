# Testing and Mocking with Alloy

This guide covers the testing utilities exposed by `alloy-di/test` for use with Vitest, including manual overrides, provider application, automocking of dependencies, and lazy-loaded services.

## Prerequisites

- Vitest peer dependency: `vitest >=4.0.14 <5.0.0`
- Install and configure Vitest in your project.

## Module: `alloy-di/test`

The testing entry provides helpers to build a container tailored for tests.

### `createTestContainer(options?)`

Creates a container instance with optional overrides and automocking. Returns a handle with convenient accessors.

Options:

- `overrides?: { instances?: Array<[Newable, instance]>; tokens?: Array<[Token<T>, T]> }`
- `providers?: ProviderDefinitions | ProviderDefinitions[]` — apply provider blocks to the container.
- `autoMock?: boolean` — enable automocking.
- `target?: Newable` — the focal class whose dependency graph will be traversed for automocking.

Returned handle:

- `get<T>(ctor: Newable<T>): Promise<T>` — resolve a class.
- `getToken<T>(token: Token<T>): T` — retrieve a provided token value.
- `provideToken<T>(token: Token<T>, value: T): void` — provide or update a token value.
- `getMock<T>(ctor: Newable<T>): MockOf<T> | undefined` — get a specific class mock.
- `getMocks<T extends readonly Newable[]>(ctors: T): [...]` — tuple-preserving batch mock retrieval.
- `restore(): void` — restores the DI registry and any patched lazy importers; call this after each test.

### `MockOf<T>`

A typed mock instance for a class. Its `spies` map contains Vi spies for prototype methods, and fields mirror callable methods for ergonomic usage.

```ts
export type MockOf<T> = Partial<T> & {
  spies: Record<Extract<MethodKeys<T>, string>, ReturnType<typeof vi.fn>>;
  __target: Newable<T>;
};
```

## Manual Overrides

You can manually override instances and token values for deterministic tests.

```ts
import { createTestContainer } from "alloy-di/test";
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
import { createTestContainer } from "alloy-di/test";

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
- `get` returns a Promise because services may be lazy-loaded.
- Vitest must be installed in projects using `alloy-di/test`.

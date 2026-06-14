# @alloy-di/testing

Runner-neutral test-container utilities for [Alloy DI](https://alloy-di.dev), with thin
adapters for popular test runners.

- `@alloy-di/testing` — the runner-neutral core (`createTestContainer`, mocking types). Requires
  you to supply a `mockFn` when using `autoMock`.
- `@alloy-di/testing/vitest` — wires `vi.fn` from Vitest.
- `@alloy-di/testing/jest` — wires `jest.fn` from `@jest/globals`.
- `@alloy-di/testing/node` — wires `mock.fn()` from `node:test`.

## Usage

```ts
import { createTestContainer } from "@alloy-di/testing/vitest";

const test = createTestContainer({
  autoMock: true,
  target: UserService,
  providers,
});

afterEach(() => test.restore());
```

Or let the adapter manage cleanup for you:

```ts
import { setupAlloyTesting } from "@alloy-di/testing/vitest";

const alloyTesting = setupAlloyTesting(); // registers afterEach once

const test = alloyTesting.createTestContainer({
  autoMock: true,
  target: UserService,
  providers,
});
```

Importing an adapter never registers test hooks on its own — only `setupAlloyTesting()` does.

## Migration from `alloy-di/test`

`alloy-di/test` is deprecated and re-exports `@alloy-di/testing/vitest`. Replace:

```ts
import { createTestContainer } from "alloy-di/test";
```

with:

```ts
import { createTestContainer } from "@alloy-di/testing/vitest";
```

`alloy-di/test` will be removed in the next major release.

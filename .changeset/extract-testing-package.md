---
"@alloy-di/testing": major
"alloy-di": major
---

Extract the test-container utilities into a new published package,
`@alloy-di/testing`, with a runner-neutral core and thin adapters:

- `@alloy-di/testing` — runner-neutral `createTestContainer` (supply your own
  `mockFn`), plus `MockOf`, `GenericSpy`/`AnySpy`, and `MockFnFactory` types.
- `@alloy-di/testing/vitest` — wires `vi.fn`.
- `@alloy-di/testing/jest` — wires `jest.fn` from `@jest/globals`.
- `@alloy-di/testing/node` — wires `mock.fn()` from `node:test`.

Each adapter exposes both a direct `createTestContainer` and a hook-registering
`setupAlloyTesting()` for automatic per-test cleanup. Importing an adapter never
registers test hooks on its own.

**BREAKING (`alloy-di`):** the `alloy-di/test` entry has been **removed**.
Migrate testing imports to a `@alloy-di/testing` adapter:

```ts
// Before
import { createTestContainer } from "alloy-di/test";
// After
import { createTestContainer } from "@alloy-di/testing/vitest";
```

`alloy-di` no longer depends on a test runner at all (the `vitest` peer
dependency has been dropped); `@alloy-di/testing` owns that coupling.

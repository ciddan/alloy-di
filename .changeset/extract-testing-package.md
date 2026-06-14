---
"@alloy-di/testing": major
"alloy-di": minor
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

`alloy-di/test` is now **deprecated**: it re-exports `@alloy-di/testing/vitest`,
preserving today's zero-config Vitest behavior, and will be removed in the next
major release. Migrate imports from `alloy-di/test` to
`@alloy-di/testing/vitest`. Using the deprecated entry requires installing
`@alloy-di/testing`.

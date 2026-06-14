// Runner-neutral test-container core. Adapters (`@alloy-di/testing/vitest`,
// `/jest`, `/node`) pre-wire the runner's mock function; use this entry
// directly only if you supply your own `mockFn`.

export { createToken } from "alloy-di/runtime"; // convenience re-export for tests

export {
  createTestContainer,
  type CreateTestContainerOptions,
  type FactoryOverrideSpec,
  type OverrideSpec,
  type TestContainerHandle,
  type TestScopeHierarchy,
} from "./lib/core";

export type { GenericSpy, MockFnFactory, MockOf } from "./lib/mocking";

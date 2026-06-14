// oxlint-disable no-unsafe-type-assertion -- adapter merges runner bindings onto caller options.
import { afterEach, mock } from "node:test";

import {
  createTestContainer as createCore,
  type CreateTestContainerOptions,
  type OverrideSpec,
} from "../lib/core";

/** A `node:test` mock function, as produced by `mock.fn()`. */
export type NodeSpy = ReturnType<typeof mock.fn>;

/** Options accepted by the node:test adapter (the `mockFn`/`resetFn` bindings are supplied for you). */
export type NodeTestContainerOptions = Omit<
  CreateTestContainerOptions<NodeSpy>,
  "mockFn" | "resetFn"
>;

const binding = {
  mockFn: () => mock.fn(),
  resetFn: (spy: NodeSpy) => {
    spy.mock.resetCalls();
  },
};

/**
 * Create a test container wired to `node:test` mocks (`mock.fn()`). Does not
 * register any cleanup hooks — call `handle.restore()` yourself, or use
 * {@link setupAlloyTesting} for automatic cleanup.
 */
export function createTestContainer(
  opts?: NodeTestContainerOptions | OverrideSpec,
) {
  return createCore<NodeSpy>({
    ...(opts as CreateTestContainerOptions<NodeSpy>),
    ...binding,
  });
}

export type NodeTestContainer = ReturnType<typeof createTestContainer>;

/**
 * Register a `node:test` `afterEach` hook that restores and clears every
 * container created through the returned `createTestContainer`. Call this once
 * per test file (or in a shared setup file).
 */
export function setupAlloyTesting() {
  const handles = new Set<NodeTestContainer>();

  afterEach(() => {
    for (const handle of [...handles].toReversed()) {
      handle.clearMockSpies();
      handle.restore();
    }
    handles.clear();
  });

  return {
    createTestContainer(
      opts?: NodeTestContainerOptions | OverrideSpec,
    ): NodeTestContainer {
      const handle = createTestContainer(opts);
      handles.add(handle);
      return handle;
    },
  };
}

export { createToken } from "../index";
export type {
  CreateTestContainerOptions,
  FactoryOverrideSpec,
  GenericSpy,
  MockFnFactory,
  MockOf,
  OverrideSpec,
  TestContainerHandle,
  TestScopeHierarchy,
} from "../index";

// oxlint-disable no-unsafe-type-assertion -- adapter merges runner bindings onto caller options.
import { afterEach, jest } from "@jest/globals";
import type { Mock } from "jest-mock";

import {
  createTestContainer as createCore,
  type CreateTestContainerOptions,
  type OverrideSpec,
} from "../lib/core";

/** A Jest spy, as produced by `jest.fn()`. */
export type JestSpy = Mock;

/** Options accepted by the Jest adapter (the `mockFn`/`resetFn` bindings are supplied for you). */
export type JestTestContainerOptions = Omit<
  CreateTestContainerOptions<JestSpy>,
  "mockFn" | "resetFn"
>;

const binding = {
  mockFn: () => jest.fn(),
  resetFn: (spy: JestSpy) => {
    spy.mockReset();
  },
};

/**
 * Create a test container wired to Jest spies (`jest.fn`). Does not register
 * any cleanup hooks — call `handle.restore()` yourself, or use
 * {@link setupAlloyTesting} for automatic cleanup.
 */
export function createTestContainer(
  opts?: JestTestContainerOptions | OverrideSpec,
) {
  return createCore<JestSpy>({
    ...(opts as CreateTestContainerOptions<JestSpy>),
    ...binding,
  });
}

export type JestTestContainer = ReturnType<typeof createTestContainer>;

/**
 * Register a Jest `afterEach` hook that restores and clears every container
 * created through the returned `createTestContainer`. Call this once per test
 * file (or in a shared setup file).
 */
export function setupAlloyTesting() {
  const handles = new Set<JestTestContainer>();

  afterEach(() => {
    for (const handle of [...handles].toReversed()) {
      handle.clearMockSpies();
      handle.restore();
    }
    handles.clear();
  });

  return {
    createTestContainer(
      opts?: JestTestContainerOptions | OverrideSpec,
    ): JestTestContainer {
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

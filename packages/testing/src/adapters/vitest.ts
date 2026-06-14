// oxlint-disable no-unsafe-type-assertion -- adapter merges runner bindings onto caller options.
import { afterEach, type Mock, vi } from "vitest";

import {
  createTestContainer as createCore,
  type CreateTestContainerOptions,
  type OverrideSpec,
} from "../lib/core";

/** A Vitest spy, as produced by `vi.fn()`. */
export type VitestSpy = Mock;

/** Options accepted by the Vitest adapter (the `mockFn`/`resetFn` bindings are supplied for you). */
export type VitestTestContainerOptions = Omit<
  CreateTestContainerOptions<VitestSpy>,
  "mockFn" | "resetFn"
>;

const binding = {
  mockFn: () => vi.fn(),
  resetFn: (spy: VitestSpy) => {
    spy.mockReset();
  },
};

/**
 * Create a test container wired to Vitest spies (`vi.fn`). Does not register
 * any cleanup hooks — call `handle.restore()` yourself, or use
 * {@link setupAlloyTesting} for automatic cleanup.
 */
export function createTestContainer(
  opts?: VitestTestContainerOptions | OverrideSpec,
) {
  return createCore<VitestSpy>({
    ...(opts as CreateTestContainerOptions<VitestSpy>),
    ...binding,
  });
}

export type VitestTestContainer = ReturnType<typeof createTestContainer>;

/**
 * Register a Vitest `afterEach` hook that restores and clears every container
 * created through the returned `createTestContainer`. Call this once per test
 * file (or in a shared setup file).
 */
export function setupAlloyTesting() {
  const handles = new Set<VitestTestContainer>();

  afterEach(() => {
    for (const handle of [...handles].toReversed()) {
      handle.clearMockSpies();
      handle.restore();
    }
    handles.clear();
  });

  return {
    createTestContainer(
      opts?: VitestTestContainerOptions | OverrideSpec,
    ): VitestTestContainer {
      const handle = createTestContainer(opts);
      handles.add(handle);
      return handle;
    },
  };
}

export { createToken } from "../index";
export type {
  AnySpy,
  CreateTestContainerOptions,
  FactoryOverrideSpec,
  GenericSpy,
  MockFnFactory,
  MockOf,
  OverrideSpec,
  TestContainerHandle,
  TestScopeHierarchy,
} from "../index";

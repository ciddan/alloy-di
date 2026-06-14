// oxlint-disable no-explicit-any, no-unsafe-type-assertion

import {
  type Container,
  isConstructor,
  isLazy,
  type Newable,
} from "alloy-di/runtime";
import { getRawDependencies } from "./registry";

// Extract method names of an object type
type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

/**
 * The minimal shape the runner-neutral core relies on for a spy. Runner
 * adapters supply richer spy types (e.g. Vitest's `Mock`) which flow through
 * the generic `S` parameter, so callers keep full runner-specific typing.
 */
export type GenericSpy = ((...args: any[]) => any) & {
  mock?: { calls: any[][] };
};

/** Alias for {@link GenericSpy}. */
export type AnySpy = GenericSpy;

/** Factory that produces a fresh spy function (e.g. `vi.fn`, `jest.fn`). */
export type MockFnFactory<S = GenericSpy> = () => S;

/** Typed mock shape returned for class auto-mocking. */
export type MockOf<T, S = GenericSpy> = Partial<T> & {
  /** Map of method name -> spy function */
  spies: Record<Extract<MethodKeys<T>, string>, S>;
  /** Original constructor reference for introspection */
  __target: Newable<T>;
};

export interface ClassMock<T, S = GenericSpy> {
  target: Newable<T>;
  mock: MockOf<T, S>;
}

/** Create a lightweight auto-mock instance for a class constructor. */
export function mockClass<T, S = GenericSpy>(
  ctor: Newable<T>,
  mockFn: MockFnFactory<S>,
): ClassMock<T, S> {
  const proto = ctor.prototype;
  const spies: Record<string, S> = {};
  const mockObj: Record<string, unknown> = {
    spies,
    __target: ctor,
  };
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") {
      continue;
    }
    const value = (proto as Record<string, unknown>)[key];
    if (typeof value === "function") {
      const fn = mockFn();
      spies[key] = fn;
      mockObj[key] = fn;
    }
  }
  return { target: ctor, mock: mockObj as MockOf<T, S> };
}

type DependencyGraph = {
  constructors: Set<Newable<unknown>>;
  lazyDependencies: Array<{ lazy: any }>;
};

type LazyPatch = { lazy: any; originalImporter: () => Promise<unknown> };

function collectDependencyGraph(target: Newable<unknown>): DependencyGraph {
  const constructors = new Set<Newable<unknown>>();
  const lazyDependencies: Array<{ lazy: any }> = [];
  const queue: Newable<unknown>[] = [target];
  const visited = new Set<Newable<unknown>>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    constructors.add(current);

    const deps = getRawDependencies(current);
    for (const dep of deps) {
      if (isLazy(dep)) {
        lazyDependencies.push({ lazy: dep });
        continue;
      }
      if (isConstructor(dep)) {
        queue.push(dep);
      }
    }
  }

  return { constructors, lazyDependencies };
}

function createMocksForConstructors<S>(
  constructors: Set<Newable<unknown>>,
  target: Newable<unknown>,
  overrides: Set<Newable<unknown>>,
  mockFn: MockFnFactory<S>,
): Map<Newable<unknown>, MockOf<unknown, S>> {
  const mocks = new Map<Newable<unknown>, MockOf<unknown, S>>();
  for (const ctor of constructors) {
    if (ctor === target) {
      continue;
    }
    if (overrides.has(ctor)) {
      continue;
    }
    const classMock = mockClass(ctor, mockFn);
    mocks.set(ctor, classMock.mock);
  }
  return mocks;
}

function applyMocksToContainer<S>(
  container: Container,
  mocks: Map<Newable<unknown>, MockOf<unknown, S>>,
): void {
  for (const [ctor, mock] of mocks.entries()) {
    container.overrideInstance(ctor, mock as unknown);
  }
}

function patchLazyDependencies<S>(
  lazyDeps: Array<{ lazy: any }>,
  mocks: Map<Newable<unknown>, MockOf<unknown, S>>,
  overrides: Set<Newable<unknown>>,
  mockFn: MockFnFactory<S>,
): LazyPatch[] {
  const patches: LazyPatch[] = [];
  for (const { lazy } of lazyDeps) {
    const originalImporter = lazy.importer;
    lazy.importer = async () => {
      const realCtor = (await originalImporter()) as Newable<unknown>;
      let mockObj = mocks.get(realCtor);
      if (!overrides.has(realCtor) && !mockObj) {
        const classMock = mockClass(realCtor, mockFn);
        mockObj = classMock.mock;
        mocks.set(realCtor, mockObj);
      }
      if (!mockObj) {
        return realCtor;
      }
      return buildMockCtorFrom(realCtor, mockObj);
    };
    patches.push({ lazy, originalImporter });
  }
  return patches;
}

export interface AutoMockResult<S = GenericSpy> {
  mocks: Map<Newable<unknown>, MockOf<unknown, S>>;
  lazyPatches?: Array<{ lazy: any; originalImporter: () => Promise<unknown> }>;
}

export interface AutoMockOptions<S = GenericSpy> {
  target: Newable<unknown>;
  container: Container;
  overridesCtors: Set<Newable<unknown>>;
  mockFn: MockFnFactory<S>;
  depth?: number; // future enhancement: max traversal depth
}

/** Traverse dependency graph (deep) and create class mocks, including lazy deps. */
export function applyAutoMocks<S = GenericSpy>(
  options: AutoMockOptions<S>,
): AutoMockResult<S> {
  const { target, container, overridesCtors, mockFn } = options;
  const graph = collectDependencyGraph(target);
  const mocks = createMocksForConstructors(
    graph.constructors,
    target,
    overridesCtors,
    mockFn,
  );
  applyMocksToContainer(container, mocks);
  const lazyPatches = patchLazyDependencies(
    graph.lazyDependencies,
    mocks,
    overridesCtors,
    mockFn,
  );
  return { mocks, lazyPatches };
}

/** Build a class constructor that exposes spies from a mock object via prototype methods */
function buildMockCtorFrom<T, S>(
  realCtor: Newable<T>,
  mock: MockOf<T, S>,
): Newable<T> {
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  function MockCtor() {}
  const proto = realCtor.prototype as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") {
      continue;
    }
    const v = proto[key];
    if (typeof v === "function" && key in mock.spies) {
      (MockCtor as unknown as { prototype: Record<string, unknown> }).prototype[
        key
      ] = mock.spies[
        key as Extract<keyof typeof mock.spies, string>
      ] as unknown as (...args: unknown[]) => unknown;
    }
  }
  return MockCtor as unknown as Newable<T>;
}

// oxlint-disable no-explicit-any, no-unsafe-type-assertion

import type { Newable } from "../types";
import { isConstructor } from "../types";
import { getRawDependencies } from "./registry";
import { isLazy } from "../lazy";
import type { Container } from "../container";
import { vi } from "vitest";

// Extract method names of an object type
type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

/** Typed mock shape returned for class auto-mocking. */
export type MockOf<T> = Partial<T> & {
  /** Map of method name -> vi spy function */
  spies: Record<Extract<MethodKeys<T>, string>, ReturnType<typeof vi.fn>>;
  /** Original constructor reference for introspection */
  __target: Newable<T>;
};

export interface ClassMock<T> {
  target: Newable<T>;
  mock: MockOf<T>;
}

/** Create a lightweight auto-mock instance for a class constructor. */
export function mockClass<T>(ctor: Newable<T>): ClassMock<T> {
  const proto = ctor.prototype;
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
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
      const fn = vi.fn();
      spies[key] = fn;
      mockObj[key] = fn;
    }
  }
  return { target: ctor, mock: mockObj as MockOf<T> };
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

function createMocksForConstructors(
  constructors: Set<Newable<unknown>>,
  target: Newable<unknown>,
  overrides: Set<Newable<unknown>>,
): Map<Newable<unknown>, MockOf<unknown>> {
  const mocks = new Map<Newable<unknown>, MockOf<unknown>>();
  for (const ctor of constructors) {
    if (ctor === target) {
      continue;
    }
    if (overrides.has(ctor)) {
      continue;
    }
    const classMock = mockClass(ctor);
    mocks.set(ctor, classMock.mock);
  }
  return mocks;
}

function applyMocksToContainer(
  container: Container,
  mocks: Map<Newable<unknown>, MockOf<unknown>>,
): void {
  for (const [ctor, mock] of mocks.entries()) {
    container.overrideInstance(ctor, mock as unknown);
  }
}

function patchLazyDependencies(
  lazyDeps: Array<{ lazy: any }>,
  mocks: Map<Newable<unknown>, MockOf<unknown>>,
  overrides: Set<Newable<unknown>>,
): LazyPatch[] {
  const patches: LazyPatch[] = [];
  for (const { lazy } of lazyDeps) {
    const originalImporter = lazy.importer;
    lazy.importer = async () => {
      const realCtor = (await originalImporter()) as Newable<unknown>;
      let mockObj = mocks.get(realCtor);
      if (!overrides.has(realCtor) && !mockObj) {
        const classMock = mockClass(realCtor);
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

export interface AutoMockResult {
  mocks: Map<Newable<unknown>, MockOf<unknown>>;
  lazyPatches?: Array<{ lazy: any; originalImporter: () => Promise<unknown> }>;
}

export interface AutoMockOptions {
  target: Newable<unknown>;
  container: Container;
  overridesCtors: Set<Newable<unknown>>;
  depth?: number; // future enhancement: max traversal depth
}

/** Traverse dependency graph (deep) and create class mocks, including lazy deps. */
export function applyAutoMocks(options: AutoMockOptions): AutoMockResult {
  const { target, container, overridesCtors } = options;
  const graph = collectDependencyGraph(target);
  const mocks = createMocksForConstructors(
    graph.constructors,
    target,
    overridesCtors,
  );
  applyMocksToContainer(container, mocks);
  const lazyPatches = patchLazyDependencies(
    graph.lazyDependencies,
    mocks,
    overridesCtors,
  );
  return { mocks, lazyPatches };
}

/** Build a class constructor that exposes spies from a mock object via prototype methods */
function buildMockCtorFrom<T>(
  realCtor: Newable<T>,
  mock: MockOf<T>,
): Newable<T> {
  // oxlint-disable-next-line: unicorn/consistent-function-scoping
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dependenciesRegistry } from "../decorators";
import { Container } from "../container";
import { Lazy } from "../lazy";
import type { Newable } from "../types";
import { applyAutoMocks, mockClass } from "./mocking";
import type { MockOf } from "./mocking";

type RegistryEntry = Parameters<(typeof dependenciesRegistry)["set"]>;

describe("mockClass", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates spies for prototype methods and preserves constructor metadata", () => {
    class ExampleService {
      greet(name: string) {
        return `hello ${name}`;
      }

      compute(value: number) {
        return value * 2;
      }

      nonFunction = "should not be copied";
    }

    const { target, mock } = mockClass(ExampleService);

    expect(target).toBe(ExampleService);

    mock.greet?.("world");
    mock.compute?.(21);

    expect(mock.spies.greet).toHaveBeenCalledWith("world");
    expect(mock.spies.compute).toHaveBeenCalledWith(21);
    expect(mock).not.toHaveProperty("nonFunction");
    expect(mock.__target).toBe(ExampleService);
  });
});

describe("applyAutoMocks", () => {
  let baselineRegistry: RegistryEntry[];

  beforeEach(() => {
    baselineRegistry = Array.from(
      dependenciesRegistry.entries(),
    ) as RegistryEntry[];
    dependenciesRegistry.clear();
  });

  afterEach(() => {
    dependenciesRegistry.clear();
    for (const [ctor, meta] of baselineRegistry) {
      dependenciesRegistry.set(ctor, meta);
    }
    vi.restoreAllMocks();
  });

  it("auto-mocks dependency graph, skipping the target itself", async () => {
    class Leaf {
      ping() {
        return "leaf";
      }
    }
    class Branch {
      grow() {
        return "branch";
      }
    }
    class LazyOnly {
      run() {
        return "lazy";
      }
    }
    class Root {
      execute() {
        return "root";
      }
    }

    dependenciesRegistry.set(Leaf, {
      dependencies: () => [],
    });
    dependenciesRegistry.set(Branch, {
      dependencies: () => [Leaf],
    });

    const lazyDep = Lazy(() => Promise.resolve(LazyOnly));

    dependenciesRegistry.set(Root, {
      dependencies: () => [Branch, lazyDep],
    });

    const container = new Container();
    const overrideSpy = vi.spyOn(container, "overrideInstance");

    const result = applyAutoMocks({
      target: Root,
      container,
      overridesCtors: new Set<Newable<unknown>>(),
    });

    expect(overrideSpy).toHaveBeenCalledTimes(2);
    const overriddenCtors = overrideSpy.mock.calls.map((call) => call[0]);
    expect(overriddenCtors).toContain(Branch);
    expect(overriddenCtors).toContain(Leaf);
    expect(overriddenCtors).not.toContain(Root);

    expect(result.mocks.get(Branch)).toBeDefined();
    expect(result.mocks.get(Leaf)).toBeDefined();
    expect(result.mocks.get(Root)).toBeUndefined();

    expect(result.lazyPatches?.length).toBe(1);
    const patchedCtor = (await lazyDep.importer()) as Newable<LazyOnly>;
    const instance = new patchedCtor();
    instance.run?.();

    const lazyMock = result.mocks.get(LazyOnly) as MockOf<LazyOnly> | undefined;
    expect(lazyMock).toBeDefined();
    expect(lazyMock?.spies.run).toHaveBeenCalledTimes(1);
  });

  it("respects manual overrides by skipping mocked constructors", () => {
    class Leaf {}
    class Branch {}
    class Root {}

    dependenciesRegistry.set(Leaf, {
      dependencies: () => [],
    });
    dependenciesRegistry.set(Branch, {
      dependencies: () => [Leaf],
    });
    dependenciesRegistry.set(Root, {
      dependencies: () => [Branch],
    });

    const container = new Container();
    const overrideSpy = vi.spyOn(container, "overrideInstance");

    const overrides = new Set<Newable<unknown>>([Branch]);

    const result = applyAutoMocks({
      target: Root,
      container,
      overridesCtors: overrides,
    });

    expect(overrideSpy).toHaveBeenCalledTimes(1);
    expect(overrideSpy).toHaveBeenCalledWith(Leaf, expect.any(Object));
    expect(result.mocks.has(Branch)).toBe(false);
    expect(result.mocks.has(Leaf)).toBe(true);
  });
});

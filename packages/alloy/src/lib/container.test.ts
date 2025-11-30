import { beforeEach, describe, expect, it, vi } from "vitest";
import { dependenciesRegistry, deps, Injectable } from "./decorators";
import { Container } from "./container";
import { Lazy } from "./lazy";
import { ServiceScope } from "./scope";
import { Newable } from "./types";

// Pure arrow used to validate isConstructor false branch on functions
const pureDepArrow = () => {};

const factoryLazy = <T extends Newable<unknown>>(
  importer: () => Promise<{ default: T } | T>,
): Lazy<Newable<unknown>> =>
  Lazy(importer) as unknown as Lazy<Newable<unknown>>;

// --- Test Classes ---

@Injectable()
class ServiceA {
  public id = Math.random(); // To check for singleton instances
}

@Injectable([ServiceA])
class ServiceB {
  constructor(public serviceA: ServiceA) {}
}

@Injectable([ServiceB])
class ServiceC {
  constructor(public serviceB: ServiceB) {}
}

@Injectable(() => [CircularB])
class CircularA {
  constructor(public circularB: CircularB) {}
}

@Injectable(() => [CircularA])
class CircularB {
  constructor(public circularA: CircularA) {}
}

// --- Lazy Test Classes ---

@Injectable()
class LazyService {
  public id = "lazy-service";
}

@Injectable([Lazy(() => Promise.resolve({ default: LazyService }))])
class ServiceWithLazyDep {
  constructor(public lazyService: LazyService) {}
}

// --- Singleton Test Class ---
@Injectable("singleton")
class SingletonService {
  public id = Math.random();
}

@Injectable(deps(SingletonService))
class NeedsSingletonService {
  constructor(public singleton: SingletonService) {}
}

@Injectable(deps(NeedsSingletonService))
class SingletonChainTop {
  constructor(public child: NeedsSingletonService) {}
}

describe("Container", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  it("should create an instance of a class without dependencies", async () => {
    const instance = await container.get(ServiceA);
    expect(instance).toBeInstanceOf(ServiceA);
  });

  it("should create a new instance each time for transient dependencies", async () => {
    const instance1 = await container.get(ServiceA);
    const instance2 = await container.get(ServiceA);
    expect(instance1).not.toBe(instance2);
  });

  it("should resolve dependencies automatically", async () => {
    const instanceB = await container.get(ServiceB);
    expect(instanceB).toBeInstanceOf(ServiceB);
    expect(instanceB.serviceA).toBeInstanceOf(ServiceA);
  });

  it("should resolve multi-level dependencies", async () => {
    const instanceC = await container.get(ServiceC);
    expect(instanceC).toBeInstanceOf(ServiceC);
    expect(instanceC.serviceB).toBeInstanceOf(ServiceB);
    expect(instanceC.serviceB.serviceA).toBeInstanceOf(ServiceA);
  });

  it("should reuse singleton instances declared via decorator", async () => {
    const instance1 = await container.get(SingletonService);
    const instance2 = await container.get(SingletonService);
    expect(instance1).toBe(instance2);
  });

  it("should return the same instance for singleton dependencies", async () => {
    const dep1 = await container.get(NeedsSingletonService);
    const dep2 = await container.get(NeedsSingletonService);

    expect(dep1.singleton).toBe(dep2.singleton);
  });

  it("should handle a mix of singleton and transient dependencies", async () => {
    const chain1 = await container.get(SingletonChainTop);
    const chain2 = await container.get(SingletonChainTop);

    expect(chain1).not.toBe(chain2); // top-level transient
    expect(chain1.child).not.toBe(chain2.child); // intermediate transient
    expect(chain1.child.singleton).toBe(chain2.child.singleton); // leaf singleton
  });

  it("should throw a clear error for circular dependencies", async () => {
    await expect(container.get(CircularA)).rejects.toThrow(
      "Circular dependency detected: CircularA -> CircularB -> CircularA",
    );
  });

  it("should resolve a lazy dependency", async () => {
    const instance = await container.get(ServiceWithLazyDep);
    expect(instance).toBeInstanceOf(ServiceWithLazyDep);
    expect(instance.lazyService).toBeInstanceOf(LazyService);
    expect(instance.lazyService.id).toBe("lazy-service");
  });

  it("should respect singleton scope defined in the decorator", async () => {
    const instance1 = await container.get(SingletonService);
    const instance2 = await container.get(SingletonService);
    expect(instance1).toBe(instance2);
    expect(instance1.id).toBe(instance2.id);
  });

  it("should not duplicate singleton under concurrent resolution", async () => {
    const [i1, i2, i3] = await Promise.all([
      container.get(SingletonService),
      container.get(SingletonService),
      container.get(SingletonService),
    ]);
    expect(i1).toBe(i2);
    expect(i2).toBe(i3);
  });

  it("should wrap errors from failing lazy imports with context", async () => {
    @Injectable()
    class FailingLazyDep {}

    @Injectable([
      // Force lazy dependency to be typed as FailingLazyDep while still rejecting at runtime.
      Lazy<FailingLazyDep>(() => Promise.reject(new Error("Network failure"))),
    ])
    class ServiceWithFailingLazy {
      constructor(public dep: FailingLazyDep) {}
    }

    await expect(container.get(ServiceWithFailingLazy)).rejects.toThrow(
      /Failed to import lazy dependency while resolving ServiceWithFailingLazy/,
    );
    await expect(container.get(ServiceWithFailingLazy)).rejects.toThrow(
      /Network failure/,
    );
  });

  it("should include original non-Error values from failing lazy imports", async () => {
    @Injectable()
    class StringFail {}

    @Injectable([
      // Reject with a string to hit String(err) branch
      Lazy<StringFail>(() => Promise.reject("bad-things-happened")),
    ])
    class ServiceWithStringFailLazy {
      constructor(public dep: StringFail) {}
    }

    await expect(container.get(ServiceWithStringFailLazy)).rejects.toThrow(
      /Failed to import lazy dependency while resolving ServiceWithStringFailLazy/,
    );
    await expect(container.get(ServiceWithStringFailLazy)).rejects.toThrow(
      /Original error: bad-things-happened/,
    );
  });

  it("should resolve a lazy dependency when importer returns class without default export", async () => {
    @Injectable()
    class PlainLazy {}

    @Injectable([
      // Return the class directly (no { default }) to cover non-default path
      Lazy(() => Promise.resolve(PlainLazy)),
    ])
    class UsesPlainLazy {
      constructor(public dep: PlainLazy) {}
    }

    const instance = await container.get(UsesPlainLazy);
    expect(instance.dep).toBeInstanceOf(PlainLazy);
  });

  it("should throw when lazy importer does not return a class", async () => {
    @Injectable()
    class NeedsAClass {}

    @Injectable([
      // Return a non-constructor value to hit isConstructor false branch
      Lazy((() => Promise.resolve({ default: 123 })) as unknown as any),
    ])
    class UsesNonClassLazy {
      constructor(public _: NeedsAClass) {}
    }

    await expect(container.get(UsesNonClassLazy)).rejects.toThrow(
      /Lazy importer did not return a class for dependency while resolving UsesNonClassLazy/,
    );
  });

  it("should throw for invalid dependency types (number, arrow function)", async () => {
    // @ts-expect-error invalid dependency type at compile time too
    @Injectable([123])
    class BadNumberDep {
      // empty
    }

    await expect(container.get(BadNumberDep)).rejects.toThrow(
      /Invalid dependency type while resolving BadNumberDep.*Received type: number/,
    );

    // @ts-expect-error invalid dependency function (not a constructor)
    @Injectable([pureDepArrow])
    class BadFnDep {
      // empty
    }

    await expect(container.get(BadFnDep)).rejects.toThrow(
      /Invalid dependency type while resolving BadFnDep.*Received type: function/,
    );
  });

  it("should clean up pending singleton on constructor failure and retry on subsequent get", async () => {
    @Injectable("singleton")
    class Explodes {
      constructor() {
        throw new Error("boom");
      }
    }

    const [r1, r2] = await Promise.allSettled([
      container.get(Explodes),
      container.get(Explodes),
    ]);

    expect(r1.status).toBe("rejected");
    expect(r2.status).toBe("rejected");
    // After failure, pending should be cleared and a new attempt should run (and fail again)
    await expect(container.get(Explodes)).rejects.toThrow(/boom/);
  });

  it("should memoize dependency array evaluation", async () => {
    @Injectable()
    class Leaf {}

    @Injectable([Leaf])
    class WithMemoizedDep {
      constructor(public leaf: Leaf) {}
    }

    // Spy on the dependency function created by the decorator
    const options = dependenciesRegistry.get(WithMemoizedDep);
    const originalDepFn = options?.dependencies;
    const spy = vi.fn(originalDepFn);

    dependenciesRegistry.set(WithMemoizedDep, {
      ...options,
      dependencies: spy,
    });

    const a = await container.get(WithMemoizedDep);
    const b = await container.get(WithMemoizedDep);

    // Transient class returns different instance but dependency function should run once.
    expect(a).not.toBe(b);
    expect(a.leaf).not.toBe(b.leaf);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warns once when factory-lazy constructor is resolved directly", async () => {
    class FactoryLazyPlaceholder {}
    class RealService {
      run() {
        return true;
      }
    }

    dependenciesRegistry.set(FactoryLazyPlaceholder, {
      scope: ServiceScope.TRANSIENT,
      dependencies: () => [],
      factory: factoryLazy(() => Promise.resolve({ default: RealService })),
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const instance = await container.get(
      FactoryLazyPlaceholder as unknown as new () => RealService,
    );

    expect(instance).toBeInstanceOf(RealService);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    await container.get(
      FactoryLazyPlaceholder as unknown as new () => RealService,
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();

    dependenciesRegistry.delete(
      FactoryLazyPlaceholder as unknown as Newable<unknown>,
    );
  });

  it("does not warn for provider placeholders annotated with __alloyLazy", async () => {
    class ProviderPlaceholder {
      static __alloyLazy = true;
    }
    class RealService {
      // empty
    }
    dependenciesRegistry.set(ProviderPlaceholder, {
      scope: ServiceScope.TRANSIENT,
      dependencies: () => [],
      factory: factoryLazy(() => Promise.resolve({ default: RealService })),
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const instance = await container.get(
      ProviderPlaceholder as unknown as new () => RealService,
    );
    expect(instance).toBeInstanceOf(RealService);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    dependenciesRegistry.delete(
      ProviderPlaceholder as unknown as Newable<unknown>,
    );
  });
});

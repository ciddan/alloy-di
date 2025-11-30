// oxlint-disable no-unused-vars, no-extraneous-class

import { assertDeps, deps, Injectable, Singleton } from "./decorators";
import { describe, expectTypeOf, it } from "vitest";
import { Lazy } from "./lazy";

describe("Decorator Type-Safety", () => {
  it("should enforce constructor parameters for @Injectable", () => {
    class Dep1 {}
    class Dep2 {}
    class WrongDep {}

    // Correct usage
    expectTypeOf(Injectable([Dep1, Dep2])).toMatchTypeOf<
      (target: new (d1: Dep1, d2: Dep2) => unknown) => void
    >();

    // --- Negative Tests ---
    // Note: TypeScript does not enforce decorator parameter types against the decorated class.
    // Use assertDeps(...) for compile-time verification (zero runtime cost).

    @Injectable([Dep1, Dep2])
    class NotEnoughParams {
      constructor(private dep1: Dep1) {}
    }
    // @ts-expect-error Not enough constructor parameters
    assertDeps(deps(Dep1, Dep2), NotEnoughParams);

    // @ts-expect-error Not enough constructor parameters
    @Injectable([Dep1])
    class TooManyParams {
      constructor(
        private dep1: Dep1,
        private dep2: Dep2,
      ) {}
    }
    // @ts-expect-error Too many constructor parameters
    assertDeps(deps(Dep1), TooManyParams);

    @Injectable([Dep1])
    class MismatchedParam {
      constructor(private wrong: WrongDep) {}
    }
    // @ts-expect-error Mismatched constructor parameter type
    assertDeps(deps(Dep1), MismatchedParam);

    @Injectable([Dep1, Dep2])
    class MismatchedOrder {
      constructor(
        private dep2: Dep2,
        private dep1: Dep1,
      ) {}
    }
    // @ts-expect-error Mismatched parameter order
    assertDeps(deps(Dep1, Dep2), MismatchedOrder);
  });

  it("should enforce constructor parameters for @Singleton", () => {
    class Dep1 {}
    class WrongDep {}

    // Correct usage
    expectTypeOf(Singleton([Dep1])).toExtend<
      (target: new (d1: Dep1) => unknown) => void
    >();

    @Singleton([Dep1])
    class MismatchedSingleton {
      constructor(private wrong: WrongDep) {}
    }
    // @ts-expect-error Mismatched constructor parameter type
    assertDeps(deps(Dep1), MismatchedSingleton);
  });

  it("should handle lazy dependencies", () => {
    class LazyDep {}

    // Correct usage
    expectTypeOf(Injectable([Lazy(() => Promise.resolve(LazyDep))])).toExtend<
      (target: new (d1: LazyDep) => unknown) => void
    >();

    // @ts-expect-error Constructor expects the resolved type, not the Lazy wrapper
    @Injectable([Lazy(() => Promise.resolve(LazyDep))])
    class MismatchedLazy {
      constructor(private lazy: Lazy<LazyDep>) {}
    }
    // @ts-expect-error Constructor expects the resolved type, not the Lazy wrapper
    assertDeps(deps(Lazy(() => Promise.resolve(LazyDep))), MismatchedLazy);
  });

  it("should handle circular dependencies via function syntax", () => {
    class CircularA {}
    class CircularB {}

    // This is a runtime check, but we can still check the decorator's return type
    expectTypeOf(Injectable(() => [CircularB])).toExtend<
      (target: new (d1: CircularB) => unknown) => void
    >();
  });
});

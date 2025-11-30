import {
  assertDeps,
  dependenciesRegistry,
  deps,
  Injectable,
  Singleton,
} from "./decorators";
import { describe, expect, it } from "vitest";

describe("Decorators runtime behavior", () => {
  it("registers singleton with deps() and exposes metadata in registry", () => {
    class Dep {}

    @Singleton(deps(Dep))
    class UsesDep {
      constructor(public d: Dep) {}
    }

    const meta = dependenciesRegistry.get(UsesDep);
    expect(meta?.scope).toBe("singleton");
    expect(typeof meta?.dependencies).toBe("function");
    expect(meta?.dependencies?.()).toEqual([Dep]);
  });

  it("deps() returns a callable that preserves tuple contents", () => {
    class A {}
    class B {}
    const ret = deps(A, B);
    expect(ret()).toEqual([A, B]);
  });

  it("assertDeps returns the same class without side effects", () => {
    class D {}
    @Injectable(deps(D))
    class C {
      constructor(public d: D) {}
    }
    const v = (assertDeps as unknown as (a: any, b: any) => any)(deps(D), C);
    expect(v).toBe(C);
  });

  it("Injectable without deps registers transient scope", () => {
    @Injectable()
    class NoDeps {}
    const meta = dependenciesRegistry.get(NoDeps);
    expect(meta?.scope).toBe("transient");
    expect(meta?.dependencies).toBeUndefined();
  });
});

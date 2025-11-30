import { describe, it, expect } from "vitest";

import { Container } from "./container";
import { DependencyResolutionError } from "./dependency-error";
import { Lazy } from "./lazy";
import { isToken, createToken, Constructor } from "./types";

describe("Container internals", () => {
  it("formatStackPath formats A -> B -> C", () => {
    class A {}
    class B {}
    class C {}

    const c: any = new Container();
    const formatted = c.formatStackPath(C, [A, B]);
    expect(formatted).toBe("A -> B -> C");
  });

  it("formatStackPath handles empty stack (just target)", () => {
    class Only {}
    const c: any = new Container();
    const formatted = c.formatStackPath(Only, []);
    expect(formatted).toBe("Only");
  });

  it("isToken detects objects with symbol id", () => {
    const good = { id: Symbol("tkn"), description: "desc" };
    const alsoGood = { id: Symbol("tkn2") };
    expect(isToken(good)).toBe(true);
    expect(isToken(alsoGood)).toBe(true);
  });

  it("isToken rejects non-token shapes", () => {
    const bad1 = { id: "not-a-symbol" } as const;
    const bad2 = null;
    const bad3 = 123;
    const bad4 = {};
    class Klass {}
    const bad5 = Klass;

    expect(isToken(bad1)).toBe(false);
    expect(isToken(bad2)).toBe(false);
    expect(isToken(bad3)).toBe(false);
    expect(isToken(bad4)).toBe(false);
    expect(isToken(bad5)).toBe(false);
  });

  describe("DependencyResolutionError", () => {
    it("includes stack path and constructor references", () => {
      class Parent {}
      class Child {}

      const error = new DependencyResolutionError("boom", {
        target: Child,
        resolutionStack: [Parent],
        failedDependency: Parent,
      });

      const details = error.toDetailedString();
      expect(details).toContain("Parent -> Child");
      expect(details).toContain("constructor Parent");
    });

    it("describes various dependency shapes", () => {
      class Target {}
      const token = createToken<number>("cfg");
      const lazy = Lazy(async () => Target);
      const anonInline = (() => {}) as () => unknown;
      const cases: Array<[unknown, RegExp]> = [
        [Target, /constructor Target/],
        [token, /token\(cfg\)/],
        [lazy, /Lazy\(import\)/],
        [anonInline, /anonInline/],
        [42, /42/],
      ];

      for (const [failed, pattern] of cases) {
        const err = new DependencyResolutionError("fail", {
          target: Target,
          resolutionStack: [] as Constructor[],
          failedDependency: failed,
        });
        expect(err.toDetailedString()).toMatch(pattern);
      }
    });
  });
});

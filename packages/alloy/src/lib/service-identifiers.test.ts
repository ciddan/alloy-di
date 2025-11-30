import { beforeEach, describe, expect, it } from "vitest";
import type { ServiceIdentifier } from "./service-identifiers";
import {
  clearServiceIdentifierRegistry,
  getConstructorByIdentifier,
  getServiceIdentifier,
  registerServiceIdentifier,
} from "./service-identifiers";

describe("service identifier registry", () => {
  beforeEach(() => {
    clearServiceIdentifierRegistry();
  });

  describe("registerServiceIdentifier", () => {
    it("memoizes identifiers per constructor", () => {
      class Foo {}
      const first = registerServiceIdentifier(Foo);
      const second = registerServiceIdentifier(Foo);

      expect(second).toBe(first);
      expect(getConstructorByIdentifier(first)).toBe(Foo);
    });

    it("honors an explicit identifier when provided first", () => {
      class Explicit {}
      const explicitIdentifier = Symbol(
        "Explicit",
      ) as ServiceIdentifier<Explicit>;

      const registered = registerServiceIdentifier(
        Explicit,
        explicitIdentifier,
      );
      const repeated = registerServiceIdentifier(Explicit);

      expect(registered).toBe(explicitIdentifier);
      expect(repeated).toBe(explicitIdentifier);
      expect(getConstructorByIdentifier(explicitIdentifier)).toBe(Explicit);
    });

    it("ignores conflicting explicit identifiers for an already registered constructor", () => {
      class Gamma {}
      const canonical = registerServiceIdentifier(Gamma);
      const conflicting = Symbol("GammaConflict") as ServiceIdentifier<Gamma>;

      const result = registerServiceIdentifier(Gamma, conflicting);

      expect(result).toBe(canonical);
      expect(getConstructorByIdentifier(conflicting)).toBeUndefined();
    });

    it("throws when an explicit identifier is already bound to a different constructor", () => {
      class Alpha {}
      class Beta {}
      const shared = registerServiceIdentifier(Alpha);

      expect(() =>
        registerServiceIdentifier(Beta, shared as ServiceIdentifier<Beta>),
      ).toThrow(
        "ServiceIdentifier is already associated with a different constructor.",
      );
    });
  });

  describe("getServiceIdentifier", () => {
    it("creates identifiers lazily and reuses them", () => {
      class Lazy {}
      const first = getServiceIdentifier(Lazy);
      const second = registerServiceIdentifier(Lazy);

      expect(second).toBe(first);
      expect(getConstructorByIdentifier(first)).toBe(Lazy);
    });
  });

  describe("getConstructorByIdentifier", () => {
    it("returns undefined for unknown identifiers", () => {
      const unknown = Symbol("Unknown") as ServiceIdentifier;

      expect(getConstructorByIdentifier(unknown)).toBeUndefined();
    });
  });

  describe("registry clearing utilities", () => {
    it("clearServiceIdentifierRegistry removes all associations", () => {
      class Resettable {}
      const beforeClear = registerServiceIdentifier(Resettable);

      clearServiceIdentifierRegistry();

      expect(getConstructorByIdentifier(beforeClear)).toBeUndefined();
      const afterClear = registerServiceIdentifier(Resettable);
      expect(afterClear).not.toBe(beforeClear);
    });
  });
});

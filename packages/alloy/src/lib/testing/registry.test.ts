import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dependenciesRegistry } from "../decorators";
import { Lazy } from "../lazy";
import { createToken } from "../types";
import {
  getDirectDependencies,
  getRawDependencies,
  restoreRegistry,
  snapshotRegistry,
} from "./registry";

type RegistryEntry = Parameters<(typeof dependenciesRegistry)["set"]>;

describe("testing registry utilities", () => {
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
  });

  describe("snapshotRegistry", () => {
    it("creates an independent copy of the registry state", () => {
      class Alpha {}
      dependenciesRegistry.set(Alpha, {
        dependencies: () => [],
      });

      const snapshot = snapshotRegistry();

      class Beta {}
      dependenciesRegistry.set(Beta, {
        dependencies: () => [],
      });

      expect(snapshot.size).toBe(1);
      expect(snapshot.get(Alpha)).toBeDefined();
      expect(snapshot.has(Beta)).toBe(false);
    });
  });

  describe("restoreRegistry", () => {
    it("restores the registry to a previous snapshot", () => {
      class Original {}
      dependenciesRegistry.set(Original, {
        dependencies: () => [],
      });

      const snapshot = snapshotRegistry();

      class Replacement {}
      dependenciesRegistry.clear();
      dependenciesRegistry.set(Replacement, {
        dependencies: () => [],
      });

      restoreRegistry(snapshot);

      expect(dependenciesRegistry.has(Original)).toBe(true);
      expect(dependenciesRegistry.has(Replacement)).toBe(false);
    });
  });

  describe("getDirectDependencies", () => {
    it("returns only constructor dependencies, skipping tokens and lazies", () => {
      class DirectA {}
      class DirectB {}
      class LazyResolved {}
      const CONFIG = createToken<string>("config");

      const lazyDep = Lazy(() =>
        Promise.resolve({
          default: LazyResolved,
        }),
      );

      class NeedsStuff {}
      dependenciesRegistry.set(NeedsStuff, {
        dependencies: () => [DirectA, lazyDep, CONFIG, DirectB],
      });

      const dependencies = getDirectDependencies(NeedsStuff);

      expect(dependencies).toEqual([DirectA, DirectB]);
    });

    it("returns an empty array when no metadata is registered", () => {
      class Unregistered {}

      const deps = getDirectDependencies(Unregistered);

      expect(deps).toEqual([]);
    });
  });

  describe("getRawDependencies", () => {
    it("returns the declared dependency tuple verbatim", () => {
      class RawA {}
      class RawB {}
      const TOKEN = createToken<number>("answer");
      const lazyDep = Lazy(() => Promise.resolve({ default: RawB }));

      class RawConsumer {}
      const tuple = [RawA, TOKEN, lazyDep] as const;
      dependenciesRegistry.set(RawConsumer, {
        dependencies: () => tuple,
      });

      const raw = getRawDependencies(RawConsumer);

      expect(raw).toBe(tuple);
    });

    it("returns an empty array when no entry exists", () => {
      class Missing {}

      const raw = getRawDependencies(Missing);

      expect(Array.isArray(raw)).toBe(true);
      expect(raw.length).toBe(0);
    });
  });
});

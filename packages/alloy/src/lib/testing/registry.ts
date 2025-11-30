// oxlint-disable no-explicit-any, no-unsafe-type-assertion

import { dependenciesRegistry } from "../decorators";
import type { Newable, Token } from "../types";
import { isToken } from "../types";
import { Lazy } from "../lazy";
import type { ServiceScope } from "../scope";

// Snapshot structure type re-exposed for potential advanced usage.
export type RegistrySnapshot = Map<
  Newable<unknown>,
  {
    dependencies?: () => readonly (
      | Newable<unknown>
      | Lazy<unknown>
      | Token<unknown>
    )[];
    scope?: ServiceScope;
    factory?: Lazy<Newable<unknown>>;
  }
>;

/** Take a deep(ish) snapshot of current dependency registry state. */
export function snapshotRegistry(): RegistrySnapshot {
  return new Map(dependenciesRegistry);
}

/** Restore dependency registry from a prior snapshot. */
export function restoreRegistry(snapshot: RegistrySnapshot): void {
  dependenciesRegistry.clear();
  for (const [k, v] of snapshot.entries()) {
    dependenciesRegistry.set(k, v);
  }
}

/** Gather direct dependency constructors for a given target. */
export function getDirectDependencies(
  target: Newable<unknown>,
): readonly Newable<unknown>[] {
  const entry = dependenciesRegistry.get(target);
  if (!entry || !entry.dependencies) {
    return [] as const;
  }

  const raw = entry.dependencies();
  const ctors: Newable<unknown>[] = [];
  for (const dep of raw) {
    // Skip tokens; lazies are filtered by the constructor check below.
    if (isToken(dep)) {
      continue;
    }

    if (typeof dep === "function") {
      ctors.push(dep);
    }
  }

  return ctors;
}

/** Get raw declared dependencies including constructors, Lazy and Tokens */
export function getRawDependencies(
  target: Newable<unknown>,
): readonly (Newable<unknown> | Lazy<unknown> | Token<unknown>)[] {
  const entry = dependenciesRegistry.get(target);
  const depsFn = entry?.dependencies ?? (() => [] as const);
  return depsFn();
}

// oxlint-disable no-explicit-any, no-unsafe-type-assertion

export { createToken } from "./lib/types"; // convenience re-export for tests
export type { MockOf } from "./lib/testing/mocking";

import type { Newable, Token } from "./lib/types";
import type { ServiceIdentifier } from "./lib/service-identifiers";
import { Container } from "./lib/container";
import { applyAutoMocks, type MockOf } from "./lib/testing/mocking";
import { snapshotRegistry, restoreRegistry } from "./lib/testing/registry";
import { vi } from "vitest";
import type { ProviderDefinitions } from "./lib/providers";
import { applyProviders } from "./lib/providers";

export interface OverrideSpec {
  /** Class constructor instance overrides */
  instances?: Array<[Newable<unknown>, unknown]>;
  /** Token value overrides */
  tokens?: Array<[Token<unknown>, unknown]>;
}

export interface CreateTestContainerOptions {
  overrides?: OverrideSpec;
  autoMock?: boolean;
  target?: Newable<unknown>; // focal service for auto-mocking immediate dependencies
  providers?: ProviderDefinitions | ProviderDefinitions[];
}

export interface TestContainerHandle {
  container: Container;
  get<T>(target: Newable<T> | ServiceIdentifier<T>): Promise<T>;
  getIdentifier?<T>(ctor: Newable<T>): ServiceIdentifier<T>;
  /** Retrieve a token value via a synthetic classless access */
  getToken<T>(token: Token<T>): T;
  /** Provide a token value into the container */
  provideToken?<T>(token: Token<T>, value: T): void;
  /** Placeholder restore hook (future phases may implement overlay stacks). */
  restore(): void;
  /** Retrieve a single class mock (if autoMock enabled). */
  getMock?<T>(ctor: Newable<T>): MockOf<T> | undefined;
  /** Retrieve multiple class mocks preserving tuple order. */
  getMocks?<T extends readonly Newable<unknown>[]>(
    ctors: T,
  ): {
    [K in keyof T]: T[K] extends Newable<infer I>
      ? MockOf<I> | undefined
      : never;
  };
  /** Convenience: get a specific method spy from a mock. */
  spyOf?<T>(
    ctor: Newable<T>,
    method: Extract<keyof T, string>,
  ): ReturnType<typeof vi.fn> | undefined;
  /** Convenience: reset all mock spies (calls vi.fn().mockReset()). */
  clearMockSpies?(): void;
}

/**
 * Create a test-focused container with manual overrides.
 * - Does not perform auto-mocking (Phase 2 will expand this).
 */
export function createTestContainer(
  opts?: CreateTestContainerOptions | OverrideSpec,
): TestContainerHandle & {
  getMock<T>(ctor: Newable<T>): MockOf<T> | undefined;
  getMocks<T extends readonly Newable<unknown>[]>(
    ctors: T,
  ): {
    [K in keyof T]: T[K] extends Newable<infer I>
      ? MockOf<I> | undefined
      : never;
  };
  provideToken<T>(token: Token<T>, value: T): void;
} {
  // Backward compatibility: allow passing OverrideSpec directly (Phase 1 style)
  const isLegacy =
    !!opts &&
    !("autoMock" in opts) &&
    !("target" in opts) &&
    !("overrides" in opts);
  const normalizedOpts: CreateTestContainerOptions = isLegacy
    ? { overrides: opts as OverrideSpec }
    : (opts ?? {});
  const overrides =
    normalizedOpts.overrides ?? (isLegacy ? (opts as OverrideSpec) : undefined);
  const container = new Container();
  // Take a snapshot of the registry before applying providers/overrides/mocks
  const snapshot = snapshotRegistry();

  // Apply providers block(s) if supplied
  if (normalizedOpts.providers) {
    applyProviders(container, normalizedOpts.providers);
  }

  // Apply token overrides first
  for (const [tok, value] of overrides?.tokens ?? []) {
    container.provideValue(tok, value);
  }

  const overriddenCtors = new Set<Newable<unknown>>(
    overrides?.instances?.map(([c]) => c) ?? [],
  );

  // Apply instance overrides for classes
  for (const [ctor, instance] of overrides?.instances ?? []) {
    container.overrideInstance(ctor, instance);
  }

  let mocks: Map<Newable<unknown>, MockOf<unknown>> | undefined;
  let lazyPatches:
    | Array<{ lazy: any; originalImporter: () => Promise<unknown> }>
    | undefined;
  if (normalizedOpts.autoMock && normalizedOpts.target) {
    const auto = applyAutoMocks({
      target: normalizedOpts.target,
      container,
      overridesCtors: overriddenCtors,
    });
    mocks = auto.mocks;
    lazyPatches = auto.lazyPatches;
  }

  return {
    container,
    get: <T>(target: Newable<T> | ServiceIdentifier<T>) =>
      typeof target === "symbol"
        ? container.getByIdentifier(target)
        : container.get(target),
    getIdentifier: <T>(ctor: Newable<T>) => container.getIdentifier(ctor),
    getToken: <T>(token: Token<T>): T => {
      return container.getToken(token);
    },
    provideToken: <T>(token: Token<T>, value: T): void => {
      container.provideValue(token, value);
    },
    getMock: <T>(ctor: Newable<T>): MockOf<T> | undefined => {
      return (mocks?.get(ctor) as MockOf<T> | undefined) ?? undefined;
    },
    getMocks: <T extends readonly Newable<unknown>[]>(ctors: T) => {
      return ctors.map((c) => mocks?.get(c) as unknown) as {
        [K in keyof T]: T[K] extends Newable<infer I>
          ? MockOf<I> | undefined
          : never;
      };
    },
    spyOf: <T>(ctor: Newable<T>, method: Extract<keyof T, string>) => {
      const m = mocks?.get(ctor) as MockOf<T> | undefined;
      const spy = m?.spies[method as Extract<keyof typeof m.spies, string>];
      return spy;
    },
    clearMockSpies: () => {
      if (!mocks) {
        return;
      }
      for (const [, m] of mocks) {
        const spies = m.spies as Record<string, ReturnType<typeof vi.fn>>;
        for (const key of Object.keys(spies)) {
          spies[key].mockReset();
        }
      }
    },
    restore: () => {
      // Restore lazy importers if patched
      for (const patch of lazyPatches ?? []) {
        patch.lazy.importer = patch.originalImporter;
      }
      // Restore the registry snapshot to undo any transient modifications
      restoreRegistry(snapshot);
    },
  };
}

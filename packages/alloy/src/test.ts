// oxlint-disable no-explicit-any, no-unsafe-type-assertion

export { createToken } from "./lib/types"; // convenience re-export for tests
export type { MockOf } from "./lib/testing/mocking";

import type { Newable, Token } from "./lib/types";
import type { ServiceIdentifier } from "./lib/service-identifiers";
import { Container } from "./lib/container";
import type { FactoryFn } from "./lib/container";
import type { ServiceScope } from "./lib/scope";
import { applyAutoMocks, type MockOf } from "./lib/testing/mocking";
import { snapshotRegistry, restoreRegistry } from "./lib/testing/registry";
import { vi } from "vitest";
import type { ProviderDefinitions } from "./lib/providers";
import { applyProviders } from "./lib/providers";
import { createScope, type Scope } from "./scopes";

export type FactoryOverrideSpec<T = unknown> = [
  token: Token<T>,
  factory: FactoryFn<T>,
  options?: { lifecycle?: ServiceScope },
];

export type TestScopeHierarchy = Record<string, { parent?: ServiceScope }>;

export interface OverrideSpec {
  /** Class constructor instance overrides */
  instances?: Array<[Newable<unknown>, unknown]>;
  /** Token value overrides */
  tokens?: Array<[Token<unknown>, unknown]>;
  /**
   * Token factory overrides. These are explicit token-keyed overrides and are
   * not affected by autoMock, which only mocks class constructor dependencies.
   * Token value overrides still take precedence for the same token.
   */
  factories?: FactoryOverrideSpec[];
}

export interface CreateTestContainerOptions {
  overrides?: OverrideSpec;
  autoMock?: boolean;
  target?: Newable<unknown>; // focal service for auto-mocking immediate dependencies
  providers?: ProviderDefinitions | ProviderDefinitions[];
  /** Custom scope hierarchy for tests, matching alloy({ scopes }) shape. */
  scopes?: TestScopeHierarchy;
}

export interface TestContainerHandle {
  container: Container;
  get<T>(target: Newable<T> | ServiceIdentifier<T>): Promise<T>;
  getIdentifier?<T>(ctor: Newable<T>): ServiceIdentifier<T>;
  /** Retrieve a token value via a synthetic classless access */
  getToken<T>(token: Token<T>): T;
  /** Provide a token value into the container */
  provideToken?<T>(token: Token<T>, value: T): void;
  /** Provide a token factory into the container */
  provideFactory?<T>(
    token: Token<T>,
    factory: FactoryFn<T>,
    options?: { lifecycle?: ServiceScope },
  ): void;
  /** Alias for provideFactory when replacing an existing test factory. */
  overrideFactory?<T>(
    token: Token<T>,
    factory: FactoryFn<T>,
    options?: { lifecycle?: ServiceScope },
  ): void;
  /** Create a scope under the test container. */
  createScope?(scopeName: ServiceScope): Scope;
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

function normalizeScopeHierarchy(
  scopes: TestScopeHierarchy,
): Record<string, string> {
  const hierarchy: Record<string, string> = {};
  for (const [scopeName, config] of Object.entries(scopes)) {
    hierarchy[scopeName] = config.parent ?? "singleton";
  }
  return hierarchy;
}

/**
 * Create a test-focused container with manual overrides.
 * - Auto-mocking, when enabled, only mocks class constructor dependencies.
 * - Token factories are explicit overrides and are applied after provider blocks.
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
  provideFactory<T>(
    token: Token<T>,
    factory: FactoryFn<T>,
    options?: { lifecycle?: ServiceScope },
  ): void;
  overrideFactory<T>(
    token: Token<T>,
    factory: FactoryFn<T>,
    options?: { lifecycle?: ServiceScope },
  ): void;
  createScope(scopeName: ServiceScope): Scope;
} {
  // Backward compatibility: allow passing OverrideSpec directly (Phase 1 style)
  const isLegacy =
    !!opts &&
    !("autoMock" in opts) &&
    !("target" in opts) &&
    !("overrides" in opts) &&
    !("providers" in opts) &&
    !("scopes" in opts);
  const normalizedOpts: CreateTestContainerOptions = isLegacy
    ? { overrides: opts as OverrideSpec }
    : (opts ?? {});
  const overrides =
    normalizedOpts.overrides ?? (isLegacy ? (opts as OverrideSpec) : undefined);
  const container = new Container();
  // Take a snapshot of the registry before applying providers/overrides/mocks
  const snapshot = snapshotRegistry();

  if (normalizedOpts.scopes) {
    container._registerScopeHierarchy(
      normalizeScopeHierarchy(normalizedOpts.scopes),
    );
  }

  // Apply providers block(s) if supplied
  if (normalizedOpts.providers) {
    applyProviders(container, normalizedOpts.providers);
  }

  // Apply factory overrides after providers so test factories replace
  // declarative provider factories. Token value overrides still win at
  // resolution time because value providers have container-level precedence.
  for (const [tok, factory, options] of overrides?.factories ?? []) {
    container.provideFactory(tok, factory, options);
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
    provideFactory: <T>(
      token: Token<T>,
      factory: FactoryFn<T>,
      options?: { lifecycle?: ServiceScope },
    ): void => {
      container.provideFactory(token, factory, options);
    },
    overrideFactory: <T>(
      token: Token<T>,
      factory: FactoryFn<T>,
      options?: { lifecycle?: ServiceScope },
    ): void => {
      container.provideFactory(token, factory, options);
    },
    createScope: (scopeName: ServiceScope): Scope => {
      return createScope(container, scopeName);
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

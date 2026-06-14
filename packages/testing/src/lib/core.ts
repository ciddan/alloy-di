// oxlint-disable no-explicit-any, no-unsafe-type-assertion

import {
  applyProviders,
  Container,
  type FactoryFn,
  type Newable,
  type ProviderDefinitions,
  type ServiceIdentifier,
  type ServiceScope,
  type Token,
} from "alloy-di/runtime";
import { createScope, type Scope } from "alloy-di/scopes";
import {
  applyAutoMocks,
  type GenericSpy,
  type MockFnFactory,
  type MockOf,
} from "./mocking";
import { restoreRegistry, snapshotRegistry } from "./registry";

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

export interface CreateTestContainerOptions<S = GenericSpy> {
  overrides?: OverrideSpec;
  autoMock?: boolean;
  target?: Newable<unknown>; // focal service for auto-mocking immediate dependencies
  providers?: ProviderDefinitions | ProviderDefinitions[];
  /** Custom scope hierarchy for tests, matching alloy({ scopes }) shape. */
  scopes?: TestScopeHierarchy;
  /**
   * Factory used to create spies for auto-mocked methods. Required when
   * `autoMock` is enabled. Runner adapters (e.g. `@alloy-di/testing/vitest`)
   * pre-wire this to the runner's mock function.
   */
  mockFn?: MockFnFactory<S>;
  /**
   * Resets a single spy created by `mockFn`. Used by `clearMockSpies()`.
   * Runner adapters pre-wire this to the runner's reset semantics.
   */
  resetFn?: (spy: S) => void;
}

export interface TestContainerHandle<S = GenericSpy> {
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
  getMock?<T>(ctor: Newable<T>): MockOf<T, S> | undefined;
  /** Retrieve multiple class mocks preserving tuple order. */
  getMocks?<T extends readonly Newable<unknown>[]>(
    ctors: T,
  ): {
    [K in keyof T]: T[K] extends Newable<infer I>
      ? MockOf<I, S> | undefined
      : never;
  };
  /** Convenience: get a specific method spy from a mock. */
  spyOf?<T>(ctor: Newable<T>, method: Extract<keyof T, string>): S | undefined;
  /** Convenience: reset all mock spies (requires a `resetFn` binding). */
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
 * - Auto-mocking, when enabled, only mocks class constructor dependencies and
 *   requires a `mockFn` binding (supplied directly or by a runner adapter).
 * - Token factories are explicit overrides and are applied after provider blocks.
 */
export function createTestContainer<S = GenericSpy>(
  opts?: CreateTestContainerOptions<S> | OverrideSpec,
): TestContainerHandle<S> & {
  getMock<T>(ctor: Newable<T>): MockOf<T, S> | undefined;
  getMocks<T extends readonly Newable<unknown>[]>(
    ctors: T,
  ): {
    [K in keyof T]: T[K] extends Newable<infer I>
      ? MockOf<I, S> | undefined
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
  spyOf<T>(ctor: Newable<T>, method: Extract<keyof T, string>): S | undefined;
  clearMockSpies(): void;
} {
  // Backward compatibility: allow passing OverrideSpec directly (Phase 1 style).
  // `mockFn`/`resetFn` are adapter-injected bindings and intentionally do not
  // disqualify the legacy shorthand (they are simply unused without autoMock).
  const isLegacy =
    !!opts &&
    !("autoMock" in opts) &&
    !("target" in opts) &&
    !("overrides" in opts) &&
    !("providers" in opts) &&
    !("scopes" in opts);
  const normalizedOpts: CreateTestContainerOptions<S> = isLegacy
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

  const resetFn = normalizedOpts.resetFn;
  let mocks: Map<Newable<unknown>, MockOf<unknown, S>> | undefined;
  let lazyPatches:
    | Array<{ lazy: any; originalImporter: () => Promise<unknown> }>
    | undefined;
  if (normalizedOpts.autoMock && normalizedOpts.target) {
    if (!normalizedOpts.mockFn) {
      throw new Error(
        "createTestContainer: `autoMock` requires a `mockFn` factory. " +
          "Use a runner adapter (e.g. `@alloy-di/testing/vitest`) or pass " +
          "`mockFn` explicitly.",
      );
    }
    const auto = applyAutoMocks<S>({
      target: normalizedOpts.target,
      container,
      overridesCtors: overriddenCtors,
      mockFn: normalizedOpts.mockFn,
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
    getMock: <T>(ctor: Newable<T>): MockOf<T, S> | undefined => {
      return (mocks?.get(ctor) as MockOf<T, S> | undefined) ?? undefined;
    },
    getMocks: <T extends readonly Newable<unknown>[]>(ctors: T) => {
      return ctors.map((c) => mocks?.get(c) as unknown) as {
        [K in keyof T]: T[K] extends Newable<infer I>
          ? MockOf<I, S> | undefined
          : never;
      };
    },
    spyOf: <T>(ctor: Newable<T>, method: Extract<keyof T, string>) => {
      const m = mocks?.get(ctor) as MockOf<T, S> | undefined;
      const spy = m?.spies[method as Extract<keyof typeof m.spies, string>];
      return spy;
    },
    clearMockSpies: () => {
      if (!mocks || !resetFn) {
        return;
      }
      for (const [, m] of mocks) {
        const spies = m.spies as Record<string, S>;
        for (const key of Object.keys(spies)) {
          resetFn(spies[key]);
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

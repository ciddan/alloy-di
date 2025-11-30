/**
 * Alloy Provider System
 * ---------------------
 * This module augments the decorator-based DI model with an explicit provider API.
 * It enables consumers to register classes, values, and lazily imported classes
 * without requiring source-level Alloy decorators inside external libraries.
 *
 * Core Concepts:
 * - ProviderDefinitions: Aggregate structure passed to `applyProviders` for bulk registration.
 * - Value Providers: Bind a token to a concrete value (simple constant / config / instance).
 * - Service Providers: Bind a class constructor with an explicit lifecycle and optional dependencies.
 * - Lazy Service Providers: Represent a class that will be imported dynamically at resolution time.
 *   These use a placeholder constructor to participate in dependency graphs while deferring the actual import.
 *
 * Lazy Mechanics:
 * The `asLazyClass` function constructs a synthetic placeholder constructor whose *identity* is used
 * as the service key in the container. This placeholder is never instantiated directly; attempts
 * to construct it throw a descriptive error. A `Lazy<Newable<T>>` factory is attached to the placeholder
 * (via a hidden symbol descriptor) so the container can perform the real dynamic import the first time
 * the service is requested.
 *
 * Dependency Declaration for Lazy Classes:
 * Because the real constructor is not available at decoration time, dependencies must be declared
 * against the placeholder. This is safe because the placeholder is cast to the eventual constructor
 * type for type-checking only; runtime instantiation flows through `factory`.
 *
 * Dependencies Option:
 * For service and lazy service providers, dependencies can be supplied either as an array or a
 * function returning an array. The function form allows avoiding premature evaluation or circular
 * reference issues. Internally everything is normalized to a thunk returning a readonly list.
 *
 * Registration Flow:
 * 1. User defines providers via helpers (`asValue`, `asClass`, `asLazyClass`) and aggregates with
 *    `defineProviders` (a light identity helper for type inference).
 * 2. `applyProviders` iterates through definitions, mapping each provider to internal DI metadata
 *    by populating `dependenciesRegistry` with scope (lifecycle), dependency thunk, and optional lazy factory.
 * 3. When a lazy service is first resolved, the container sees the factory, performs the dynamic import,
 *    and then instantiates the real constructor; subsequent singleton resolutions reuse the cached instance.
 *
 * Symbol Descriptor Rationale:
 * The private symbol `LAZY_PROVIDER_DESCRIPTOR` ensures we do not pollute the public surface of the
 * placeholder while still attaching structured metadata. The descriptor stores lifecycle, dependency
 * declarations, and the wrapped lazy factory function.
 */
import type { Container } from "./container";
import { dependenciesRegistry } from "./decorators";
import { Lazy } from "./lazy";
import { isConstructor } from "./types";
import type { Newable, Token } from "./types";
import { ServiceScope } from "./scope";

/**
 * Explicit lifecycle choices for providers. Mirrors decorator scopes but externalized.
 */
export type ProviderLifecycle = ServiceScope;

/**
 * A single dependency item can be:
 * - A constructor (class) registered or discoverable by the container.
 * - A Lazy<T> wrapper for deferred resolution of another service.
 * - A Token<T> representing a value provider.
 */
type DependencyItem = Newable<unknown> | Lazy<unknown> | Token<unknown>;

/** Readonly list of dependency items describing a constructor's injection points. */
type DependencyList = readonly DependencyItem[];

/**
 * Dependencies can be provided directly or via a thunk to support ordering / circular cases.
 */
type DependenciesOption = DependencyList | (() => DependencyList);

/**
 * Hidden symbol used to attach lazy provider metadata to its placeholder constructor.
 */
const LAZY_PROVIDER_DESCRIPTOR = Symbol("alloy.lazy-provider-descriptor");

/**
 * Placeholder constructor type for a lazily imported class.
 * It masquerades as `Newable<T>` for dependency declaration and typing, while hosting
 * a private descriptor used during provider application.
 */
type LazyPlaceholder<T = unknown> = Newable<T> & {
  [LAZY_PROVIDER_DESCRIPTOR]: LazyServiceProviderDescriptor<T>;
};

/** Descriptor for a token-value binding. */
export interface ValueProviderDescriptor<T = unknown> {
  kind: "value";
  token: Token<T>;
  value: T;
}

/** Descriptor for a concrete class provider with lifecycle and optional dependencies. */
export interface ServiceProviderDescriptor<
  T extends Newable<unknown> = Newable<unknown>,
> {
  kind: "service";
  useClass: T;
  lifecycle: ProviderLifecycle;
  deps?: DependenciesOption;
}

/**
 * Internal descriptor capturing lazy service metadata.
 * Not exposed directly to consumers; attached via symbol on the placeholder.
 */
export interface LazyServiceProviderDescriptor<T = unknown> {
  placeholder: LazyPlaceholder<T>;
  factory: Lazy<Newable<T>>;
  lifecycle: ProviderLifecycle;
  deps?: DependenciesOption;
}

/** Aggregate provider definitions for batch application. */
export interface ProviderDefinitions {
  values?: ValueProviderDescriptor[];
  services?: ServiceProviderDescriptor[];
  lazyServices?: LazyPlaceholder[];
}

/**
 * Identity helper for provider definition blocks.
 * Enables better type inference in user code without changing runtime behavior.
 */
export function defineProviders(
  defs: ProviderDefinitions,
): ProviderDefinitions {
  return defs;
}

/** Create a value provider for a given token. */
export function asValue<T>(
  token: Token<T>,
  value: T,
): ValueProviderDescriptor<T> {
  return { kind: "value", token, value };
}

/**
 * Create a class (service) provider with explicit lifecycle and optional dependencies.
 */
export function asClass<T extends Newable<unknown>>(
  useClass: T,
  options: {
    lifecycle: ProviderLifecycle;
    deps?: DependenciesOption;
  },
): ServiceProviderDescriptor<T> {
  return {
    kind: "service",
    useClass,
    lifecycle: options.lifecycle,
    deps: options.deps,
  };
}

/**
 * Convenience lifecycle helpers for fluent provider creation.
 */
export const lifecycle = {
  singleton(): ProviderLifecycle {
    return ServiceScope.SINGLETON;
  },
  transient(): ProviderLifecycle {
    return ServiceScope.TRANSIENT;
  },
} as const;

/**
 * Define a lazily imported class provider.
 *
 * Creates a placeholder constructor that stands in for the eventual imported class.
 * Dependencies can be declared immediately against this placeholder. When the container
 * resolves the service, it will invoke the attached lazy factory to perform the dynamic import.
 *
 * @param importer Dynamic import function returning the service constructor.
 * @param options.lifecycle Lifecycle scope (singleton or transient).
 * @param options.deps Optional dependencies (array or thunk) for the service.
 * @param options.label Optional display name overriding the placeholder's constructor name.
 */
export function asLazyClass<T, const TDeps extends DependenciesOption>(
  importer: () => Promise<Newable<T>>,
  options: {
    lifecycle: ProviderLifecycle;
    deps?: TDeps;
    label?: string;
  },
): LazyPlaceholder<T> {
  class AlloyLazyProvider {
    static readonly __alloyLazy = true;
    constructor() {
      throw new Error(
        "Lazy provider placeholders cannot be instantiated directly. Use container.get instead.",
      );
    }
  }
  // oxlint-disable-next-line: no-unsafe-type-assertion -- placeholder intentionally masquerades as the target service constructor for dependency declarations.
  const placeholder = AlloyLazyProvider as unknown as LazyPlaceholder<T>;
  if (options.label) {
    Object.defineProperty(placeholder, "name", {
      value: options.label,
    });
  }

  const factory = Lazy(async () => {
    const ctor = await importer();
    return ctor;
  });

  Object.defineProperty(placeholder, LAZY_PROVIDER_DESCRIPTOR, {
    value: {
      placeholder,
      // oxlint-disable-next-line: no-unsafe-type-assertion -- coercing the Lazy wrapper to reference a constructor import rather than an instance.
      factory: factory as Lazy<Newable<T>>,
      lifecycle: options.lifecycle,
      deps: options.deps,
    },
  });

  return placeholder;
}

/**
 * Normalizes dependencies option into a consistent thunk form.
 */
function normalizeDependencies(
  option?: DependenciesOption,
): () => DependencyList {
  if (!option) {
    return () => [];
  }
  if (typeof option === "function") {
    return option;
  }
  return () => option;
}

type ProviderPlanEntry = {
  ctor: Newable<unknown>;
  deps?: DependenciesOption;
};

function detectProviderCycles(entries: ProviderPlanEntry[]): void {
  if (entries.length === 0) {
    return;
  }

  const providerMap = new Map<
    Newable<unknown>,
    DependenciesOption | undefined
  >();
  for (const entry of entries) {
    providerMap.set(entry.ctor, entry.deps);
  }
  if (providerMap.size <= 1) {
    return;
  }

  const adjacency = new Map<Newable<unknown>, Newable<unknown>[]>();
  for (const [ctor, depsOption] of providerMap.entries()) {
    // Do not eagerly invoke thunk dependencies; only inspect static arrays.
    if (typeof depsOption === "function") {
      // Thunk-based deps are intentionally skipped in cycle detection to avoid
      // premature evaluation and module order issues. Cycles will still be
      // detected at runtime during resolution if they exist.
      adjacency.set(ctor, []);
      continue;
    }

    const deps: DependencyList = depsOption ?? [];
    const neighbors: Newable<unknown>[] = [];
    for (const dep of deps) {
      if (isConstructor(dep) && providerMap.has(dep)) {
        neighbors.push(dep);
      }
    }
    adjacency.set(ctor, neighbors);
  }

  const visiting = new Set<Newable<unknown>>();
  const visited = new Set<Newable<unknown>>();
  const path: Newable<unknown>[] = [];

  const dfs = (node: Newable<unknown>): void => {
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      const cyclePath = [...path.slice(cycleStart), node]
        .map((ctor) => ctor.name || "<anonymous>")
        .join(" -> ");
      throw new Error(
        `[alloy] Circular provider dependency detected: ${cyclePath}`,
      );
    }
    if (visited.has(node)) {
      return;
    }

    visiting.add(node);
    path.push(node);
    for (const dep of adjacency.get(node) ?? []) {
      dfs(dep);
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of providerMap.keys()) {
    dfs(node);
  }
}

/**
 * Apply one or more provider definition blocks to a container.
 *
 * For each service / lazy service, a registration entry is written into `dependenciesRegistry`.
 * Value providers are passed directly to the container for immediate binding.
 */
export function applyProviders(
  container: Container,
  definitions: ProviderDefinitions | ProviderDefinitions[],
): void {
  const list = Array.isArray(definitions) ? definitions : [definitions];

  const planEntries: ProviderPlanEntry[] = [];
  for (const definition of list) {
    for (const service of definition.services ?? []) {
      planEntries.push({ ctor: service.useClass, deps: service.deps });
    }
    for (const placeholder of definition.lazyServices ?? []) {
      const descriptor = placeholder[LAZY_PROVIDER_DESCRIPTOR];
      if (!descriptor) {
        continue;
      }
      planEntries.push({ ctor: descriptor.placeholder, deps: descriptor.deps });
    }
  }
  detectProviderCycles(planEntries);

  for (const definition of list) {
    // Values: bind immediately.
    for (const valueProvider of definition.values ?? []) {
      container.provideValue(valueProvider.token, valueProvider.value);
    }

    // Helper to register service metadata (normal or lazy).
    const registerService = (
      ctor: Newable<unknown>,
      lifecycle: ProviderLifecycle,
      deps?: DependenciesOption,
      factory?: Lazy<Newable<unknown>>,
    ) => {
      dependenciesRegistry.set(ctor, {
        scope: lifecycle,
        dependencies: normalizeDependencies(deps),
        factory,
      });
    };

    // Standard services.
    for (const service of definition.services ?? []) {
      registerService(service.useClass, service.lifecycle, service.deps);
    }

    // Lazy services via placeholders.
    for (const placeholder of definition.lazyServices ?? []) {
      const descriptor = placeholder[LAZY_PROVIDER_DESCRIPTOR];
      if (!descriptor) {
        continue;
      }
      registerService(
        descriptor.placeholder,
        descriptor.lifecycle,
        descriptor.deps,
        descriptor.factory,
      );
    }
  }
}

export type { LazyPlaceholder };

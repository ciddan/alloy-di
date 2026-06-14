import type { Constructor, Newable, Token } from "./lib/types";
import type {
  ServiceScope,
  ResolutionContext,
  FactoryCacheEntry,
  FactoryPendingEntry,
} from "./lib/scope";
import type { Container } from "./lib/container";
import type { ServiceIdentifier } from "./lib/service-identifiers";

/**
 * An active, hierarchical resolution context that caches scoped services and
 * supports value providers, child scope construction, and ordered disposal.
 */
export class Scope implements ResolutionContext {
  private readonly cached = new Map<Constructor, unknown>();
  private readonly pending = new Map<Constructor, Promise<unknown>>();
  private readonly valueProviders = new Map<symbol, unknown>();
  private readonly factoryValues = new Map<symbol, FactoryCacheEntry>();
  private readonly factoryPending = new Map<symbol, FactoryPendingEntry>();
  private readonly activeChildren = new Set<Scope>();

  // Track instantiation order for reverse disposal
  private readonly instantiatedInstances: unknown[] = [];

  constructor(
    public readonly parent: ResolutionContext,
    public readonly scopeName: ServiceScope,
  ) {
    if (parent instanceof Scope) {
      parent.activeChildren.add(this);
    }
  }

  /**
   * Traverse the parent contexts recursively to find the root Container.
   * @internal
   */
  public getContainer(): Container {
    if (this.parent instanceof Scope) {
      return this.parent.getContainer();
    }
    // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: parent must be the root Container if not Scope.
    return this.parent as Container;
  }

  // --- ResolutionContext Implementation ---

  public getCached(target: Constructor): unknown {
    return this.cached.get(target);
  }

  public setCached(target: Constructor, instance: unknown): void {
    this.cached.set(target, instance);
    this.instantiatedInstances.push(instance);
  }

  public getPending(target: Constructor): Promise<unknown> | undefined {
    return this.pending.get(target);
  }

  public setPending(target: Constructor, promise: Promise<unknown>): void {
    this.pending.set(target, promise);
  }

  public deletePending(target: Constructor): void {
    this.pending.delete(target);
  }

  public getProvider(tokenId: symbol): unknown {
    if (this.valueProviders.has(tokenId)) {
      return this.valueProviders.get(tokenId);
    }
    return this.parent.getProvider(tokenId);
  }

  public hasProvider(tokenId: symbol): boolean {
    if (this.valueProviders.has(tokenId)) {
      return true;
    }
    return this.parent.hasProvider(tokenId);
  }

  // Factory results are cached per-scope (a scoped factory produces one value
  // per scope instance), tagged with the producing descriptor's generation. The
  // resolved value is tracked for reverse-order disposal alongside class
  // instances.
  public getFactoryValue(tokenId: symbol): FactoryCacheEntry | undefined {
    return this.factoryValues.get(tokenId);
  }

  public setFactoryValue(
    tokenId: symbol,
    generation: number,
    value: unknown,
  ): void {
    this.factoryValues.set(tokenId, { generation, value });
    this.instantiatedInstances.push(value);
  }

  public getFactoryPending(tokenId: symbol): FactoryPendingEntry | undefined {
    return this.factoryPending.get(tokenId);
  }

  public setFactoryPending(
    tokenId: symbol,
    generation: number,
    promise: Promise<unknown>,
  ): void {
    this.factoryPending.set(tokenId, { generation, promise });
  }

  public deleteFactoryPending(tokenId: symbol, generation: number): void {
    const current = this.factoryPending.get(tokenId);
    if (current?.generation === generation) {
      this.factoryPending.delete(tokenId);
    }
  }

  // --- Public Container-like Interface ---

  /**
   * Register a value provider for a token scoped to this context.
   */
  public provideValue<T>(token: Token<T>, value: T): void {
    this.valueProviders.set(token.id, value);
  }

  /**
   * Retrieve a provided token value from this scope or its ancestors.
   */
  public getToken<T>(token: Token<T>): T {
    if (!this.hasProvider(token.id)) {
      throw new Error(
        `No provider registered for token ${token.description ?? String(token.id)}`,
      );
    }
    // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: client ensures provided value matches token type.
    return this.getProvider(token.id) as T;
  }

  /**
   * Resolve and cache a service within this hierarchical context.
   */
  public async get<T>(target: Newable<T>): Promise<T>;
  public async get<T>(identifier: ServiceIdentifier<T>): Promise<T>;
  public async get<T>(
    targetOrIdentifier: Newable<T> | ServiceIdentifier<T>,
  ): Promise<T> {
    const container = this.getContainer();
    return container._resolveInContext(targetOrIdentifier, this);
  }

  /**
   * Construct a child scope underneath this scope.
   */
  public createScope(scopeName: ServiceScope): Scope {
    return createScope(this, scopeName);
  }

  /**
   * Dispose of this scope. Disposes all child scopes first, then all instantiated
   * services in reverse instantiation order. Supports Symbol.asyncDispose,
   * Symbol.dispose, and alloyOnDestroy.
   */
  public async dispose(): Promise<void> {
    const errors: unknown[] = [];

    // 1. Dispose of all active child scopes first
    const childrenToDispose = Array.from(this.activeChildren);
    for (const child of childrenToDispose) {
      try {
        await child.dispose();
      } catch (err) {
        errors.push(err);
      }
    }
    this.activeChildren.clear();

    // 2. Dispose of services cached in this scope in reverse instantiation order
    try {
      for (let i = this.instantiatedInstances.length - 1; i >= 0; i--) {
        const instance = this.instantiatedInstances[i];
        if (!instance || typeof instance !== "object") {
          continue;
        }

        try {
          if (Symbol.asyncDispose in instance) {
            // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: call Symbol.asyncDispose.
            const disp = instance as AsyncDisposable;
            if (typeof disp[Symbol.asyncDispose] === "function") {
              await disp[Symbol.asyncDispose]();
            }
          } else if (Symbol.dispose in instance) {
            // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: call Symbol.dispose.
            const disp = instance as Disposable;
            if (typeof disp[Symbol.dispose] === "function") {
              disp[Symbol.dispose]();
            }
          } else if ("alloyOnDestroy" in instance) {
            // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: call alloyOnDestroy.
            const service = instance as { alloyOnDestroy: () => unknown };
            if (typeof service.alloyOnDestroy === "function") {
              const maybePromise = service.alloyOnDestroy();
              if (maybePromise instanceof Promise) {
                await maybePromise;
              }
            }
          }
        } catch (err) {
          errors.push(err);
        }
      }
    } finally {
      this.instantiatedInstances.length = 0;
      this.cached.clear();
      this.pending.clear();
      this.valueProviders.clear();
      this.factoryValues.clear();
      this.factoryPending.clear();

      // Remove from parent's list of active child scopes
      if (this.parent instanceof Scope) {
        this.parent.activeChildren.delete(this);
      }
    }

    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0];
      }
      throw new AggregateError(
        errors,
        "[alloy] Multiple errors occurred during scope disposal.",
      );
    }
  }

  /**
   * Support native Symbol.asyncDispose protocol for 'await using' declarations.
   */
  public [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}

/**
 * Creates a new Scope instance parented by the given context, and validates
 * its parent-child relationship against the build-time declared hierarchy.
 */
export function createScope(
  parent: ResolutionContext,
  scopeName: ServiceScope,
): Scope {
  if (parent instanceof Scope) {
    parent.getContainer()._validateScopeParent(scopeName, parent.scopeName);
    return new Scope(parent, scopeName);
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: parent must be Container if not Scope.
  const container = parent as Container;
  container._validateScopeParent(scopeName, parent.scopeName);

  return new Scope(parent, scopeName);
}

import { Constructor, Newable, Token, isConstructor, isToken } from "./types";
import { Lazy, isLazy } from "./lazy";
import { dependenciesRegistry } from "./decorators";
import { DependencyResolutionError } from "./dependency-error";
import { ServiceScope, ResolutionContext } from "./scope";
import {
  ServiceIdentifier,
  getConstructorByIdentifier,
  getServiceIdentifier,
} from "./service-identifiers";
import { isDevEnvironment } from "./env-detection";

type ServiceMetadata = {
  scope: ServiceScope;
  dependencies: readonly (Constructor | Lazy<unknown> | Token<unknown>)[];
  factory?: Lazy<Constructor>;
};

type DependencyClassification =
  | { kind: "lazy"; lazy: Lazy<unknown> }
  | { kind: "token"; token: Token<unknown> }
  | { kind: "constructor"; ctor: Constructor };

function classifyDependency(value: unknown): DependencyClassification | null {
  if (isLazy(value)) {
    return { kind: "lazy", lazy: value };
  }
  if (isToken(value)) {
    return { kind: "token", token: value };
  }
  if (isConstructor(value)) {
    return { kind: "constructor", ctor: value };
  }
  return null;
}

function hasFactory(
  metadata: ServiceMetadata | undefined,
): metadata is ServiceMetadata & { factory: Lazy<Constructor> } {
  return Boolean(metadata?.factory);
}

function isProviderPlaceholder(target: Constructor): boolean {
  return Boolean(
    typeof target === "function" &&
    "__alloyLazy" in target &&
    (target as { __alloyLazy?: unknown }).__alloyLazy === true,
  );
}

function formatFactoryLazyWarning(target: Constructor): string {
  const name = target.name || "<anonymous>";
  const hint = target.name
    ? `serviceIdentifiers.${target.name}`
    : "serviceIdentifiers.<Service>";
  const identifierHint = target.name
    ? `container.getIdentifier(${target.name})`
    : `container.getIdentifier(<Service>)`;
  return `[alloy] container.get(${name}) resolved a factory-lazy service via constructor. Use container.get(${hint}) or cache const id = ${identifierHint}; container.get(id) to preserve lazy loading.`;
}

/**
 * Runtime dependency injection container used by generated modules and tests.
 *
 * It stores metadata discovered at build time, resolves constructor dependencies,
 * performs singleton caching, and supports token-based value providers.
 */
export class Container implements ResolutionContext {
  private readonly singletons = new Map<Constructor, unknown>();
  private readonly pendingSingletons = new Map<Constructor, Promise<unknown>>();
  // Instance-level overrides for tests: when present, resolution returns the provided instance
  private readonly instanceOverrides = new Map<Constructor, unknown>();
  private readonly metadataCache = new Map<Constructor, ServiceMetadata>();
  private readonly valueProviders = new Map<symbol, unknown>();
  private readonly factoryWarningCache = new WeakSet<Constructor>();
  private readonly scopeHierarchy = new Map<ServiceScope, ServiceScope>();

  // ResolutionContext implementation
  public readonly scopeName: ServiceScope = ServiceScope.SINGLETON;
  public readonly parent: ResolutionContext | null = null;

  public getCached(target: Constructor): unknown {
    return this.singletons.get(target);
  }

  public setCached(target: Constructor, instance: unknown): void {
    this.singletons.set(target, instance);
  }

  public getPending(target: Constructor): Promise<unknown> | undefined {
    return this.pendingSingletons.get(target);
  }

  public setPending(target: Constructor, promise: Promise<unknown>): void {
    this.pendingSingletons.set(target, promise);
  }

  public deletePending(target: Constructor): void {
    this.pendingSingletons.delete(target);
  }

  public getProvider(tokenId: symbol): unknown {
    return this.valueProviders.get(tokenId);
  }

  public hasProvider(tokenId: symbol): boolean {
    return this.valueProviders.has(tokenId);
  }

  /**
   * Resolve (and construct) the requested service.
   *
   * @param target - Class constructor that was decorated with `@Injectable`/`@Singleton`.
   * @returns A promise that resolves to the instantiated service.
   */
  public async get<T>(target: Newable<T>): Promise<T>;
  public async get<T>(identifier: ServiceIdentifier<T>): Promise<T>;
  public async get<T>(
    targetOrIdentifier: Newable<T> | ServiceIdentifier<T>,
  ): Promise<T> {
    if (typeof targetOrIdentifier === "symbol") {
      return this.getByIdentifier(targetOrIdentifier);
    }
    return this.getByConstructor(targetOrIdentifier, this);
  }

  /** @internal */
  public _registerScopeHierarchy(hierarchy: Record<string, string>): void {
    for (const [child, parent] of Object.entries(hierarchy)) {
      // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: Configured scope hierarchy entries are validated at build time.
      this.scopeHierarchy.set(child as ServiceScope, parent as ServiceScope);
    }
  }

  /** @internal */
  public _validateScopeParent(
    childScope: ServiceScope,
    parentScope: ServiceScope,
  ): void {
    const declaredParent = this.scopeHierarchy.get(childScope);
    if (declaredParent && declaredParent !== parentScope) {
      throw new Error(
        `[alloy] Invalid scope hierarchy construction: scope '${String(childScope)}' is declared with parent '${String(declaredParent)}', but was constructed with parent scope '${String(parentScope)}'.`,
      );
    }
  }

  /** @internal */
  public async _resolveInContext<T>(
    target: Newable<T> | ServiceIdentifier<T>,
    context: ResolutionContext,
    options?: { skipFactoryWarning?: boolean },
  ): Promise<T> {
    if (typeof target === "symbol") {
      const ctor = getConstructorByIdentifier(target);
      if (!ctor) {
        throw new Error(
          `No service registered for identifier ${target.description ?? target.toString()}`,
        );
      }
      // oxlint-disable-next-line no-unsafe-type-assertion -- Justified: ctor retrieved from safe registry matches target constructor type.
      return this.getByConstructor(ctor as Newable<T>, context, {
        skipFactoryWarning: true,
      });
    }
    return this.getByConstructor(target, context, options);
  }

  /**
   * Provide a concrete instance override for a class constructor.
   * Used by test utilities to inject mocks/stubs without altering global metadata.
   */
  public overrideInstance<T>(target: Newable<T>, instance: T): void {
    this.instanceOverrides.set(target, instance);
    // If the target would normally be a singleton, also cache it for fast path consistency.
    this.singletons.set(target, instance);
  }

  /**
   * Retrieve the stable identifier associated with a constructor.
   * Consumers can cache this and later call {@link getByIdentifier}.
   */
  public getIdentifier<T>(target: Constructor): ServiceIdentifier<T> {
    return getServiceIdentifier<T>(target);
  }

  /**
   * Resolve a service using its stable identifier.
   * Identifiers remain safe across minification and code splitting.
   */
  public async getByIdentifier<T = unknown>(
    identifier: ServiceIdentifier<T>,
  ): Promise<T> {
    const ctor = getConstructorByIdentifier(identifier);
    if (!ctor) {
      throw new Error(
        `No service registered for identifier ${identifier.description ?? identifier.toString()}`,
      );
    }
    // oxlint-disable-next-line no-unsafe-type-assertion
    return this.getByConstructor(ctor as Newable<T>, this, {
      skipFactoryWarning: true,
    });
  }

  /**
   * Register a concrete value for an injection token at runtime.
   *
   * @param token - The token created via `createToken`.
   * @param value - The value that should be injected when the token is requested.
   */
  public provideValue<T>(token: Token<T>, value: T): void {
    this.valueProviders.set(token.id, value);
  }

  /**
   * Retrieve a provided value for a token from this container.
   * Throws if no provider is registered for the token.
   */
  public getToken<T>(token: Token<T>): T {
    if (!this.valueProviders.has(token.id)) {
      throw new Error(
        `No provider registered for token ${token.description ?? String(token.id)}`,
      );
    }
    // oxlint-disable-next-line no-unsafe-type-assertion
    return this.valueProviders.get(token.id) as T;
  }

  private async getByConstructor<T>(
    target: Newable<T>,
    context: ResolutionContext,
    options?: { skipFactoryWarning?: boolean },
  ): Promise<T> {
    if (!options?.skipFactoryWarning) {
      this.maybeWarnFactoryLazyConstructorUsage(target);
    }
    return this.resolve(target, [], context);
  }

  private maybeWarnFactoryLazyConstructorUsage(target: Constructor): void {
    if (!isDevEnvironment()) {
      return;
    }
    const metadata =
      this.metadataCache.get(target) ?? this.getServiceMetadata(target);
    if (
      !hasFactory(metadata) ||
      this.factoryWarningCache.has(target) ||
      isProviderPlaceholder(target)
    ) {
      return;
    }
    this.factoryWarningCache.add(target);
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(formatFactoryLazyWarning(target));
    }
  }

  /**
   * Resolve a constructor, managing singleton lifetimes and detecting circular dependencies.
   * This is the core resolution logic that orchestrates caching, coalescing, and instantiation.
   *
   * @param target - Service constructor to resolve
   * @param resolutionStack - Chain of services currently being resolved (for cycle detection)
   * @returns Promise resolving to the service instance
   * @throws Error if a circular dependency is detected
   */
  private async resolve<T>(
    target: Newable<T>,
    resolutionStack: Constructor[],
    context: ResolutionContext,
  ): Promise<T> {
    // Instance override fast path (test/mocking support)
    const overridden = this.instanceOverrides.get(target);
    if (overridden) {
      // oxlint-disable-next-line no-unsafe-type-assertion -- caller supplies correctly typed instance.
      return overridden as T;
    }
    // Guard: Detect circular dependencies
    if (resolutionStack.includes(target)) {
      const cycle = [...resolutionStack.map((t) => t.name), target.name].join(
        " -> ",
      );
      throw new DependencyResolutionError(
        `Circular dependency detected: ${cycle}`,
        {
          target,
          resolutionStack,
          failedDependency: target,
        },
      );
    }

    const metadata = this.getServiceMetadata(target);
    const nextStack = [...resolutionStack, target];

    const targetCtx = this.findContextForScope(metadata.scope, context);

    if (metadata.scope === ServiceScope.SINGLETON) {
      return this.resolveCached(target, metadata, nextStack, targetCtx);
    }

    if (metadata.scope === ServiceScope.TRANSIENT) {
      return this.createInstance(
        target,
        metadata.dependencies,
        nextStack,
        metadata.factory,
        targetCtx,
      );
    }

    // Custom scope
    if (targetCtx.scopeName === metadata.scope) {
      return this.resolveCached(target, metadata, nextStack, targetCtx);
    }

    // Fallback for custom scope (treated as transient on targetCtx)
    return this.createInstance(
      target,
      metadata.dependencies,
      nextStack,
      metadata.factory,
      targetCtx,
    );
  }

  private findContextForScope(
    scope: ServiceScope,
    startingContext: ResolutionContext,
  ): ResolutionContext {
    if (scope === ServiceScope.SINGLETON) {
      let current = startingContext;
      while (current.parent) {
        current = current.parent;
      }
      return current;
    }

    if (scope === ServiceScope.TRANSIENT) {
      return startingContext;
    }

    let current: ResolutionContext | null = startingContext;
    while (current) {
      if (current.scopeName === scope) {
        return current;
      }
      current = current.parent;
    }

    return startingContext;
  }

  private async resolveCached<T>(
    target: Newable<T>,
    metadata: ServiceMetadata,
    resolutionStack: Constructor[],
    targetCtx: ResolutionContext,
  ): Promise<T> {
    const cached = targetCtx.getCached(target);
    if (cached) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      return cached as T;
    }

    const pending = targetCtx.getPending(target);
    if (pending) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      return (await pending) as T;
    }

    const creation = this.createInstance(
      target,
      metadata.dependencies,
      resolutionStack,
      metadata.factory,
      targetCtx,
    ).then((instance) => {
      targetCtx.setCached(target, instance);
      return instance;
    });

    targetCtx.setPending(target, creation);

    try {
      // oxlint-disable-next-line no-unsafe-type-assertion
      return (await creation) as T;
    } finally {
      targetCtx.deletePending(target);
    }
  }

  /**
   * Instantiate a class by resolving and injecting all declared dependencies.
   * Handles factory-lazy services by importing the real class before instantiation.
   *
   * @param target - Service constructor (may be a stub class if factory provided)
   * @param dependencies - Array of dependency items to resolve and inject
   * @param resolutionStack - Current resolution chain
   * @param factory - Optional lazy factory to import the real class
   * @returns Promise resolving to the instantiated service
   */
  private async createInstance<T>(
    target: Newable<T>,
    dependencies: readonly (Constructor | Lazy<unknown> | Token<unknown>)[],
    resolutionStack: Constructor[],
    factory: Lazy<Constructor> | undefined,
    context: ResolutionContext,
  ): Promise<T> {
    // If this is a factory-lazy service, import the real class
    const ctor = factory
      ? await this.importWithRetry(factory, target, resolutionStack)
      : target;

    // Resolve all dependencies in parallel
    const paramInstances = await Promise.all(
      dependencies.map((param) =>
        this.resolveParam(param, ctor, resolutionStack, context),
      ),
    );

    // Construct the service with resolved dependencies
    const instance = new ctor(...paramInstances);
    // oxlint-disable-next-line no-unsafe-type-assertion -- ctor always resolves to the concrete service for target T before instantiation.
    return instance as T;
  }

  /**
   * Resolve a single dependency entry, handling lazies, tokens, and constructors.
   * This is called for each parameter in a service's dependency array.
   *
   * @param param - Dependency item (can be Lazy, Token, or Constructor)
   * @param target - Service being constructed (for error messages)
   * @param resolutionStack - Current resolution chain
   * @returns Promise resolving to the dependency instance
   * @throws Error if dependency type is invalid
   */
  private async resolveParam(
    param: unknown,
    target: Constructor,
    resolutionStack: Constructor[],
    context: ResolutionContext,
  ): Promise<unknown> {
    const classification = classifyDependency(param);
    if (!classification) {
      const stackPath = this.formatStackPath(target, resolutionStack);
      throw new DependencyResolutionError(
        `Invalid dependency type while resolving ${target.name}. Resolution stack: ${stackPath}. Received type: ${typeof param}`,
        {
          target,
          resolutionStack,
          failedDependency: param,
        },
      );
    }

    switch (classification.kind) {
      case "lazy": {
        const depClass = await this.importWithRetry(
          classification.lazy,
          target,
          resolutionStack,
        );
        return this.resolve(
          depClass as Newable<unknown>,
          resolutionStack,
          context,
        );
      }
      case "token":
        return this.resolveTokenLike(
          classification.token,
          target,
          resolutionStack,
          context,
        );
      case "constructor":
        return this.resolve(
          classification.ctor as Newable<unknown>,
          resolutionStack,
          context,
        );
    }
    const unreachable: never = classification;
    return unreachable;
  }

  /**
   * Execute a lazy importer with optional retry/backoff semantics, then
   * validate that the imported value is a constructor.
   *
   * Only the dynamic import itself is retried; a successful import that does
   * not yield a constructor is deterministic and fails immediately without
   * backoff or re-wrapping.
   *
   * @param lazyDep - Lazy dependency wrapper with importer function and retry config
   * @param target - Service being resolved (for error messages)
   * @param resolutionStack - Current resolution chain (for cycle detection and error context)
   * @returns The imported class constructor
   * @throws Error if all retry attempts exhausted or import returns non-constructor
   */
  private async importWithRetry(
    lazyDep: Lazy<unknown>,
    target: Constructor,
    resolutionStack: Constructor[],
  ): Promise<Constructor> {
    const module = await this.runImporterWithRetry(
      lazyDep,
      target,
      resolutionStack,
    );

    // Handle both default and named exports
    const depClass =
      typeof module === "object" && module !== null && "default" in module
        ? module.default
        : module;

    // Validate imported value is a constructor
    if (!isConstructor(depClass)) {
      const stackPath = this.formatStackPath(target, resolutionStack);
      throw new DependencyResolutionError(
        `Lazy importer did not return a class for dependency while resolving ${target.name}. Resolution stack: ${stackPath}. Received type: ${typeof depClass}`,
        {
          target,
          resolutionStack,
          failedDependency: depClass,
        },
      );
    }
    return depClass;
  }

  /**
   * Run a lazy importer, retrying failed imports with exponential backoff.
   */
  private async runImporterWithRetry(
    lazyDep: Lazy<unknown>,
    target: Constructor,
    resolutionStack: Constructor[],
  ): Promise<unknown> {
    const retries = lazyDep.retry?.retries ?? 0;
    const baseDelay = lazyDep.retry?.backoffMs ?? 0;
    const factor = lazyDep.retry?.factor ?? 2;
    let attempt = 0;

    // Retry loop with exponential backoff
    while (true) {
      try {
        return await lazyDep.importer();
      } catch (err: unknown) {
        // Check if we've exhausted all retry attempts
        if (attempt >= retries) {
          const stackPath = this.formatStackPath(target, resolutionStack);
          const message = `Failed to import lazy dependency while resolving ${target.name}. Resolution stack: ${stackPath}. Original error: ${err instanceof Error ? err.message : String(err)}`;
          throw new DependencyResolutionError(message, {
            target,
            resolutionStack,
            failedDependency: lazyDep,
            cause: err,
          });
        }

        // Calculate exponential backoff delay: baseDelay * (factor ^ attempt)
        const delay = baseDelay * Math.pow(factor, attempt);
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        attempt++;
      }
    }
  }

  /**
   * Resolve a token dependency via registered value providers.
   */
  private resolveTokenLike(
    tok: { id: symbol; description?: string },
    target: Constructor,
    resolutionStack: Constructor[],
    context: ResolutionContext,
  ): unknown {
    let current: ResolutionContext | null = context;
    while (current) {
      if (current.hasProvider(tok.id)) {
        return current.getProvider(tok.id);
      }
      current = current.parent;
    }

    const stackPath = this.formatStackPath(target, resolutionStack);
    throw new DependencyResolutionError(
      `No provider registered for token ${tok.description ?? String(tok.id)} while resolving ${target.name}. Resolution stack: ${stackPath}`,
      {
        target,
        resolutionStack,
        failedDependency: tok,
      },
    );
  }

  /**
   * Format a readable representation of the resolution stack for error messages.
   */
  private formatStackPath(
    target: Constructor,
    resolutionStack: Constructor[],
  ): string {
    return [...resolutionStack.map((t) => t.name), target.name].join(" -> ");
  }

  /**
   * Retrieve (and memoize) the DI metadata for a service from the registry.
   */
  private getServiceMetadata(target: Constructor): ServiceMetadata {
    const cached = this.metadataCache.get(target);
    if (cached) {
      return cached;
    }

    const registryEntry = dependenciesRegistry.get(target as Newable<unknown>);
    if (!registryEntry) {
      return {
        scope: ServiceScope.TRANSIENT,
        dependencies: [],
      };
    }

    const scope = registryEntry.scope ?? ServiceScope.TRANSIENT;
    const depsFn = registryEntry.dependencies ?? (() => [] as const);
    const dependencies = depsFn();
    const metadata = {
      scope,
      dependencies,
      factory: registryEntry.factory as Lazy<Constructor> | undefined,
    } as const;

    this.metadataCache.set(target, metadata);
    return metadata;
  }
}

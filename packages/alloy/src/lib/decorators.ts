/* oxlint-disable no-unsafe-type-assertion */
import { Newable, Token } from "./types";
import { Lazy } from "./lazy";
import { ServiceScope } from "./scope";

/**
 * Resolve a declared dependency to the constructor parameter type expected by the service.
 *
 * - If the dependency is a `Lazy<T>`, this resolves to `T` (the eagerly-constructed type).
 * - If the dependency is a `Newable<T>` (a class constructor), this resolves to `T`.
 * - If the dependency is a `Token<T>`, this resolves to the provided value type `T`.
 * - Otherwise, resolves to `never`.
 *
 * This is used to map the `dependencies` tuple into the service constructor parameter list.
 *
 * @typeParam D - A single declared dependency item.
 */
export type ResolveDep<D> =
  D extends Lazy<infer L>
    ? L
    : D extends Newable<infer I>
      ? I
      : D extends Token<infer V>
        ? V
        : never;

/**
 * Tuple-map a declared dependencies list to the constructor parameter types.
 *
 * Given a tuple of constructors and/or `Lazy<...>` wrappers, produces a tuple of the
 * instance types the class constructor should accept.
 *
 * Example:
 * - `[Logger, Metrics]`        -> `[Logger, Metrics]` (instances)
 * - `[Lazy(() => Logger)]`     -> `[Logger]`
 *
 * @typeParam TDeps - A readonly tuple of declared dependencies.
 */
export type DepInstances<TDeps extends readonly unknown[]> = {
  [K in keyof TDeps]: ResolveDep<TDeps[K]>;
};

/**
 * Allowed shapes for the `dependencies` option.
 *
 * - A readonly tuple/array of constructors and/or `Lazy<...>` wrappers.
 * - Or a function returning such a tuple (recommended to break circular refs in the same file).
 */
type DependencyItem = Newable<unknown> | Lazy<unknown> | Token<unknown>;
type DependenciesOption =
  | readonly DependencyItem[]
  | (() => readonly DependencyItem[]);

/**
 * Strongly-typed decorator function signature used by overloads when dependencies are known.
 *
 * @typeParam TDeps - A readonly tuple of declared dependencies.
 * @internal
 */
type TypedClassDecorator<TDeps extends readonly DependencyItem[]> = (
  target: new (...args: DepInstances<TDeps>) => unknown,
) => void;

/**
 * Global registry for service metadata used by the runtime container.
 *
 * Keys are service constructors; values include the configured scope and a
 * normalized dependency function that returns the declared dependencies as a readonly tuple.
 *
 * The Vite plugin populates this from source decorators at build time, but you can also
 * register programmatically via the decorators in tests or non-plugin setups.
 *
 * @internal
 */
export const dependenciesRegistry = new Map<
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
>();

/**
 * Create the underlying decorator implementation for both `@Injectable` and `@Singleton`.
 *
 * - Normalizes `dependencies` to a function so the container can evaluate lazily/memoize.
 * - Registers the class metadata in {@link dependenciesRegistry}.
 * - Preserves strict tuple inference through the call-site overloads of the public decorators.
 *
 * @param scope - The requested lifetime: `singleton` or `transient`.
 * @param dependencies - Optional dependency list (array or factory returning an array).
 * @returns A class decorator that records the metadata into the registry.
 * @internal
 */
function createDecoratorWithDeps<const TDeps extends readonly DependencyItem[]>(
  scope: ServiceScope,
  depsOpt: (() => TDeps) | TDeps,
): TypedClassDecorator<TDeps> {
  if (typeof depsOpt === "function") {
    const depsFn = depsOpt;
    return (
      target: new (...args: DepInstances<ReturnType<typeof depsFn>>) => unknown,
    ) => {
      dependenciesRegistry.set(target as Newable<unknown>, {
        scope,
        dependencies: depsFn,
      });
    };
  }

  const deps = depsOpt;
  const depsFn = () => deps;
  return (target: new (...args: DepInstances<typeof deps>) => unknown) => {
    dependenciesRegistry.set(target as Newable<unknown>, {
      scope,
      dependencies: depsFn,
    });
  };
}

/**
 * Register scope metadata for services that declare no dependencies.
 *
 * @param scope - Lifetime associated with the decorated service.
 * @returns A class decorator that records only the scope in {@link dependenciesRegistry}.
 * @internal
 */
function createDecoratorWithoutDeps(scope: ServiceScope): ClassDecorator {
  return (target: Function) => {
    dependenciesRegistry.set(target as Newable<unknown>, {
      scope,
    });
  };
}

/**
 * Determine whether a decorator argument represents dependency metadata.
 *
 * @param value - The argument supplied to `@Injectable`/`@Singleton`.
 * @returns True if the argument is an array or factory of dependencies.
 * @internal
 */
function isDependenciesArg(value: unknown): value is DependenciesOption {
  return typeof value === "function" || Array.isArray(value);
}

/**
 * Class decorator for declaring a DI-managed service and its dependencies.
 *
 * Overloads preserve tuple inference for both array and function dependency forms, enabling
 * strict alignment between the declared dependencies and the class constructor parameter list.
 *
 * Notes:
 * - Order matters: dependencies map positionally to constructor parameters.
 * - For circular dependencies in the same file, use the function form: `@Injectable(() => [B])`.
 * - When using `Lazy(...)`, the constructor expects the resolved type, not `Lazy<T>`.
 * - Due to TypeScript limitations, decorator position may not always surface target mismatches;
 *   use {@link assertDeps} for zero-cost compile-time assertions when needed.
 *
 * @typeParam TDeps - A readonly tuple of declared dependencies.
 * @param depsOrScope - Optional dependency declaration followed by an optional scope string.
 *
 * @example Transient with a direct dependency
 * ```ts
 * @Injectable(deps(Logger))
 * class AppService {
 *   constructor(private logger: Logger) {}
 * }
 * ```
 *
 * @example Singleton shorthand via scope
 * ```ts
 * @Injectable('singleton')
 * class AppState {}
 * ```
 *
 * @example Circular dependency in the same file
 * ```ts
 * @Injectable(() => [CircularB])
 * class CircularA { constructor(private b: CircularB) {} }
 * ```
 *
 * @example Lazy dependency resolves to the underlying type
 * ```ts
 * @Injectable([Lazy(() => Promise.resolve(Logger))])
 * class NeedsLogger { constructor(private logger: Logger) {} }
 * ```
 */
export function Injectable(): ClassDecorator;
export function Injectable(scope: ServiceScope): ClassDecorator;
export function Injectable<const TDeps extends readonly DependencyItem[]>(
  dependencies: () => TDeps,
  scope?: ServiceScope,
): TypedClassDecorator<TDeps>;
export function Injectable<const TDeps extends readonly DependencyItem[]>(
  dependencies: TDeps,
  scope?: ServiceScope,
): TypedClassDecorator<TDeps>;
export function Injectable(
  depsOrScope?: DependenciesOption | ServiceScope,
  scopeOverride?: ServiceScope,
) {
  if (isDependenciesArg(depsOrScope)) {
    return createDecoratorWithDeps(
      scopeOverride ?? ServiceScope.TRANSIENT,
      depsOrScope as
        | (() => readonly DependencyItem[])
        | readonly DependencyItem[],
    );
  }

  const scope =
    (typeof depsOrScope === "string" ? depsOrScope : undefined) ??
    scopeOverride ??
    ServiceScope.TRANSIENT;
  return createDecoratorWithoutDeps(scope);
}

/**
 * Shorthand decorator for singleton services.
 *
 * Equivalent to `@Injectable(dependencies?, 'singleton')` with the same strict typing
 * and overload behaviors as {@link Injectable}.
 *
 * @typeParam TDeps - A readonly tuple of declared dependencies.
 * @param options - Singleton configuration and dependencies (array or function form).
 *
 * @example No dependencies
 * ```ts
 * @Singleton()
 * class GlobalLogger {}
 * ```
 *
 * @example With dependencies (array form)
 * ```ts
 * @Singleton(deps(Config))
 * class Metrics { constructor(private cfg: Config) {} }
 * ```
 */
export function Singleton(): ClassDecorator;
export function Singleton<const TDeps extends readonly DependencyItem[]>(
  dependencies: () => TDeps,
): TypedClassDecorator<TDeps>;
export function Singleton<const TDeps extends readonly DependencyItem[]>(
  dependencies: TDeps,
): TypedClassDecorator<TDeps>;
export function Singleton(dependencies?: DependenciesOption) {
  if (isDependenciesArg(dependencies)) {
    return createDecoratorWithDeps(
      ServiceScope.SINGLETON,
      dependencies as
        | (() => readonly DependencyItem[])
        | readonly DependencyItem[],
    );
  }
  return createDecoratorWithoutDeps(ServiceScope.SINGLETON);
}

/**
 * Declare dependencies as a strongly-typed readonly tuple without `as const`.
 *
 * This helper preserves tuple inference for strict constructor checking while keeping callsites
 * concise. It returns a function so it can be used directly as `dependencies` in the decorator.
 *
 * @typeParam T - A readonly tuple of constructors and/or `Lazy<...>` wrappers.
 * @param items - Variadic dependency list.
 * @returns A function returning the same tuple (suitable for `dependencies`).
 *
 * @example
 * ```ts
 * @Injectable(deps(Logger, Metrics))
 * class AppService { constructor(l: Logger, m: Metrics) {} }
 * ```
 */
export function deps<
  T extends readonly (Newable<unknown> | Lazy<unknown> | Token<unknown>)[],
>(...items: T): () => T {
  return () => items;
}

/**
 * Compile-time assertion: ensure constructor parameters match the resolved dependency tuple.
 *
 * This function has zero runtime cost and simply returns the class unchanged. It exists solely
 * to force a TypeScript evaluation that surfaces mismatches (number, order, or type), including
 * cases where decorator position alone may not report errors due to compiler limitations.
 *
 * @typeParam TDeps - Declared dependency tuple.
 * @typeParam TClass - Class type with a constructor that must accept `DepInstances<TDeps>`.
 * @param depsFn - A function returning the declared dependency tuple (e.g., from {@link deps}).
 * @param klass - The class constructor to validate.
 * @returns The same class constructor, unchanged.
 *
 * @example Negative test in code
 * ```ts
 * class Dep {}
 * class Wrong {}
 *
 * @Injectable(deps(Dep))
 * class UsesWrong { constructor(_: Wrong) {} }
 *
 * // @ts-expect-error mismatch detected at compile time
 * assertDeps(deps(Dep), UsesWrong);
 * ```
 */
export function assertDeps<
  TDeps extends readonly (Newable<unknown> | Lazy<unknown> | Token<unknown>)[],
  TClass extends new (...args: DepInstances<TDeps>) => unknown,
>(depsFn: () => TDeps, klass: TClass): TClass {
  return klass;
}

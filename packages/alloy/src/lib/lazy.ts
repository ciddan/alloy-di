import { Newable } from "./types";

export const LAZY_IDENTIFIER = Symbol("lazy");

type Importer<T> = () => Promise<
  | {
      default: Newable<T>;
    }
  | Newable<T>
>;

export interface Lazy<T> {
  [LAZY_IDENTIFIER]: true;
  importer: Importer<T>;
  retry?: {
    retries: number; // number of additional attempts after the first
    backoffMs?: number; // initial delay
    factor?: number; // backoff multiplier
  };
}

/**
 * Narrow an unknown value to a `Lazy` wrapper based on the hidden identifier symbol.
 */
export function isLazy(value: unknown): value is Lazy<unknown> {
  return (
    typeof value === "object" && value !== null && LAZY_IDENTIFIER in value
  );
}

/**
 * Helper type to extract the instance type from a Newable constructor.
 */
type ExtractInstanceType<T> = T extends Newable<infer I> ? I : never;

/**
 * Infers the type T from an Importer function's return type.
 * Handles both default exports and named exports.
 */
type InferLazyType<F> = F extends () => Promise<infer R>
  ? R extends { default: infer D }
    ? ExtractInstanceType<D>
    : ExtractInstanceType<R>
  : never;

/* oxlint-disable no-explicit-any -- Required for generic constraints and implementation */
/**
 * Wraps a dynamic import of a service to mark it for lazy loading.
 * When called without a type parameter, the type is automatically inferred.
 * When called with a type parameter, that type is used explicitly.
 * @param importer A function that returns a dynamic import, e.g., `() => import('./my.service').then(m => m.MyService)`
 */
export function Lazy<
  F extends () => Promise<Newable<any> | { default: Newable<any> }>,
>(importer: F, retry?: Lazy<any>["retry"]): Lazy<InferLazyType<F>>;
export function Lazy<T>(
  importer: Importer<T>,
  retry?: Lazy<T>["retry"],
): Lazy<T>;
export function Lazy(
  importer: Importer<any>,
  retry?: Lazy<any>["retry"],
): Lazy<any> {
  return {
    [LAZY_IDENTIFIER]: true,
    importer,
    retry,
  };
}
/* oxlint-enable no-explicit-any */

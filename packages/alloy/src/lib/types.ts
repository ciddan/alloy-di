/**
 * Represents a class constructor with arbitrary parameters.
 * We intentionally use `any[]` here because the DI container never inspects
 * constructor parameter types at runtime and widening to `unknown[]` causes
 * TypeScript incompatibilities (strict contravariance) when passing concrete
 * constructor signatures. Using `any` preserves ergonomic usage while remaining
 * safe: instantiation is delegated to the actual class.
 */
// oxlint-disable-next-line no-explicit-any -- Justified: DI must accept any constructor signature.
export type Newable<T> = new (...args: any[]) => T;

/** Generic constructor shape (helper for internal checks). */
// oxlint-disable-next-line no-explicit-any -- Same justification as above.
export type Constructor = new (...args: any[]) => unknown;

/** Typed token for non-class values or abstract contracts. */
export interface Token<T> {
  readonly id: symbol;
  readonly description?: string;
  // phantom type field, not used at runtime
  readonly __type?: T;
}

/** Create a unique typed token for values or abstractions. */
export function createToken<T>(description?: string): Token<T> {
  return { id: Symbol(description), description } as Token<T>;
}

export function isToken(value: unknown): value is Token<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, "id") &&
    typeof (value as { id?: unknown }).id === "symbol"
  );
}

export function isConstructor(value: unknown): value is Constructor {
  if (typeof value !== "function") {
    return false;
  }

  const proto = (value as { prototype?: unknown }).prototype;
  if (!proto || typeof proto !== "object") {
    return false;
  }

  if ((proto as { constructor?: unknown }).constructor !== value) {
    return false;
  }

  return true;
}

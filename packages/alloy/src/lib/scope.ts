import type { Constructor } from "./types";

export const ServiceScope = {
  SINGLETON: "singleton",
  TRANSIENT: "transient",
} as const;

export interface AlloyScopes {
  singleton: true;
  transient: true;
}

export type ServiceScope = keyof AlloyScopes;

/**
 * A cached factory result tagged with the `generation` of the descriptor that
 * produced it. A mismatch against the current descriptor's generation (after a
 * factory is re-registered) makes the entry stale, so it is recomputed.
 */
export interface FactoryCacheEntry {
  generation: number;
  value: unknown;
}

/** An in-flight factory resolution tagged with its descriptor generation. */
export interface FactoryPendingEntry {
  generation: number;
  promise: Promise<unknown>;
}

export interface ResolutionContext {
  readonly scopeName: ServiceScope;
  getCached(target: Constructor): unknown;
  setCached(target: Constructor, instance: unknown): void;
  getPending(target: Constructor): Promise<unknown> | undefined;
  setPending(target: Constructor, promise: Promise<unknown>): void;
  deletePending(target: Constructor): void;
  getProvider(tokenId: symbol): unknown;
  hasProvider(tokenId: symbol): boolean;
  // Token-keyed factory result cache, scoped to this context. Unlike value
  // providers (which walk the parent chain), each context caches the factory
  // result for its own lifecycle independently, so these are local lookups.
  // Entries are generation-tagged so a re-registered factory invalidates the
  // cache (the presence of an entry — not a truthy value — means "cached", so a
  // factory resolving to `undefined` still caches). `deleteFactoryPending` only
  // removes the entry when the generation matches, so a stale resolution
  // finishing after re-registration cannot clear the newer in-flight promise.
  getFactoryValue(tokenId: symbol): FactoryCacheEntry | undefined;
  setFactoryValue(tokenId: symbol, generation: number, value: unknown): void;
  getFactoryPending(tokenId: symbol): FactoryPendingEntry | undefined;
  setFactoryPending(
    tokenId: symbol,
    generation: number,
    promise: Promise<unknown>,
  ): void;
  deleteFactoryPending(tokenId: symbol, generation: number): void;
  readonly parent: ResolutionContext | null;
}

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

export interface ResolutionContext {
  readonly scopeName: ServiceScope;
  getCached(target: Constructor): unknown;
  setCached(target: Constructor, instance: unknown): void;
  getPending(target: Constructor): Promise<unknown> | undefined;
  setPending(target: Constructor, promise: Promise<unknown>): void;
  deletePending(target: Constructor): void;
  getProvider(tokenId: symbol): unknown;
  hasProvider(tokenId: symbol): boolean;
  readonly parent: ResolutionContext | null;
}

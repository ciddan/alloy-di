export { Container } from "./lib/container";
export {
  dependenciesRegistry,
  Injectable,
  Singleton,
  deps,
  assertDeps,
} from "./lib/decorators";
export { Lazy, LAZY_IDENTIFIER } from "./lib/lazy";
export {
  registerServiceIdentifier,
  getServiceIdentifier,
  getConstructorByIdentifier,
  clearServiceIdentifierRegistry,
} from "./lib/service-identifiers";
export type { ServiceIdentifier } from "./lib/service-identifiers";
export type { Newable, Token } from "./lib/types";
export { createToken } from "./lib/types";
export type { Lazy as LazyInterface } from "./lib/lazy";
export {
  defineProviders,
  asValue,
  asClass,
  asLazyClass,
  lifecycle,
  applyProviders,
} from "./lib/providers";
export type { ProviderDefinitions } from "./lib/providers";

import type { Constructor } from "./types";

/**
 * Symbol-based identifier used to resolve services in a minifier-safe way.
 * These identifiers never collide with minified constructor names and can be
 * shared between runtime and generated modules.
 */
export type ServiceIdentifier<T = unknown> = symbol & {
  readonly __serviceIdentifierBrand: unique symbol;
  readonly __type?: T;
};

let ctorToIdentifier = new WeakMap<Constructor, ServiceIdentifier>();
const identifierToCtor = new Map<ServiceIdentifier, Constructor>();

function formatIdentifierDescription(ctor: Constructor): string {
  const name = ctor?.name?.trim();
  return name ? `Service(${name})` : "Service(<anonymous>)";
}

function createServiceIdentifier(ctor: Constructor): ServiceIdentifier {
  // oxlint-disable-next-line: no-unsafe-type-assertion
  return Symbol(formatIdentifierDescription(ctor)) as ServiceIdentifier;
}

/**
 * Associates a constructor with a stable identifier. When an explicit identifier
 * is provided (e.g., by generated metadata), it becomes canonical for the
 * constructor. Attempting to reuse an identifier with a different constructor
 * throws to surface manifest/config mismatches early.
 */
export function registerServiceIdentifier<T>(
  ctor: Constructor,
  explicitIdentifier?: ServiceIdentifier<T>,
): ServiceIdentifier<T> {
  const current = ctorToIdentifier.get(ctor);
  if (current) {
    if (explicitIdentifier && explicitIdentifier !== current) {
      const owner = identifierToCtor.get(explicitIdentifier);
      if (owner && owner !== ctor) {
        throw new Error(
          "Attempted to reassign an existing ServiceIdentifier to a different constructor.",
        );
      }
    }
    // oxlint-disable-next-line: no-unsafe-type-assertion
    return current as ServiceIdentifier<T>;
  }

  const identifier =
    explicitIdentifier ??
    // oxlint-disable-next-line: no-unsafe-type-assertion
    (createServiceIdentifier(ctor) as ServiceIdentifier<T>);
  const existingOwner = identifierToCtor.get(identifier);
  if (existingOwner && existingOwner !== ctor) {
    throw new Error(
      "ServiceIdentifier is already associated with a different constructor.",
    );
  }

  ctorToIdentifier.set(ctor, identifier);
  identifierToCtor.set(identifier, ctor);
  return identifier;
}

/**
 * Retrieves the identifier for a constructor, creating one lazily when absent.
 */
export function getServiceIdentifier<T>(
  ctor: Constructor,
): ServiceIdentifier<T> {
  return registerServiceIdentifier<T>(ctor);
}

/**
 * Reverse lookup used by the container to go from identifier -> constructor.
 */
export function getConstructorByIdentifier(
  identifier: ServiceIdentifier,
): Constructor | undefined {
  return identifierToCtor.get(identifier);
}

/**
 * Removes all identifier associations. Useful for tests and tooling hooks that need a clean slate.
 */
export function clearServiceIdentifierRegistry(): void {
  ctorToIdentifier = new WeakMap<Constructor, ServiceIdentifier>();
  identifierToCtor.clear();
}

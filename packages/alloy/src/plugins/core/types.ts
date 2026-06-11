import type { ServiceScope } from "../../lib/scope";

export interface DependencyDescriptor {
  /** The source code expression for this dependency */
  expression: string;
  /** Identifiers referenced within this dependency expression */
  referencedIdentifiers: string[];
  /** Identifiers that should be ignored by visualizers/codegen (parameters, helpers, etc.) */
  ignoredIdentifiers?: string[];
  /** Whether this dependency is wrapped in Lazy(...) */
  isLazy: boolean;
}

export interface ServiceMetadata {
  scope: ServiceScope;
  dependencies: DependencyDescriptor[];
  factory?: DependencyDescriptor;
}

export interface DiscoveredMeta {
  className: string;
  filePath: string;
  identifierKey?: string;
  metadata: ServiceMetadata;
  referencedImports?: {
    name: string;
    path: string;
    originalName?: string;
    isTypeOnly?: boolean;
  }[];
}

export interface ManifestTokenDependency {
  exportName: string;
  importPath: string;
}

export interface ManifestLazyDependency {
  exportName: string;
  importPath: string;
  retry?: { retries: number; backoffMs?: number; factor?: number };
}

export interface ManifestClassDependencyEntry {
  kind: "class";
  exportName: string;
}

export interface ManifestTokenDependencyEntry extends ManifestTokenDependency {
  kind: "token";
}

export interface ManifestLazyDependencyEntry extends ManifestLazyDependency {
  kind: "lazy";
}

export type ManifestDependencyEntry =
  | ManifestClassDependencyEntry
  | ManifestTokenDependencyEntry
  | ManifestLazyDependencyEntry;

export interface ManifestServiceDescriptorBase {
  exportName: string;
  importPath: string;
  /**
   * Stable, unique key used to generate the ServiceIdentifier.
   * Format: `alloy:<package-name>/<relative-path>#<ClassName>`
   */
  symbolKey: string;
  scope: ServiceScope;
}

export interface ManifestServiceDescriptorV1 extends ManifestServiceDescriptorBase {
  deps: string[];
  /** Token dependencies (non-service identifiers) exported publicly by the package. */
  tokenDeps?: ManifestTokenDependency[];
  lazyDeps: ManifestLazyDependency[];
}

export interface ManifestServiceDescriptorV2 extends ManifestServiceDescriptorBase {
  deps: ManifestDependencyEntry[];
}

export type ManifestServiceDescriptor =
  | ManifestServiceDescriptorV1
  | ManifestServiceDescriptorV2;

export interface AlloyManifest {
  schemaVersion: number;
  packageName: string;
  buildMode: "preserve-modules" | "bundled" | "chunks";
  services: ManifestServiceDescriptor[];
  /** Optional provider module import specifiers (internal library-provided). */
  providers?: string[];
  diagnostics?: {
    barrelFallback?: boolean;
    duplicateServices?: string[];
    missingExports?: string[];
  };
}

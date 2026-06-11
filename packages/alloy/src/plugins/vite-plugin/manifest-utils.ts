import { z } from "zod";
import {
  createClassKey,
  createSymbolKey,
  normalizeImportPath,
} from "../core/utils";
import type {
  AlloyManifest,
  DiscoveredMeta,
  DependencyDescriptor,
  ManifestDependencyEntry,
  ManifestServiceDescriptorV1,
  ManifestServiceDescriptorV2,
  ServiceMetadata,
} from "../core/types";
import { IdentifierResolver } from "../core/identifier-resolver";

/**
 * Manifest utility functions specific to the Vite plugin.
 *
 * Responsibilities:
 *  - Read and parse emitted internal library manifest modules
 *  - Convert manifest service descriptors into codegen metadata (including lazy dependency expressions)
 *  - Resolve identifier collisions via aliasing
 *  - Track eager vs lazy-only references so we can generate correct static imports
 *  - Support factory-lazy service augmentation for plugin `lazyServices` configuration
 *  - Detect duplicate definitions across local discovery + ingested manifests
 */

export type LoadedManifestServiceDescriptor =
  | (ManifestServiceDescriptorV1 & { schemaVersion: 1 })
  | (ManifestServiceDescriptorV2 & { schemaVersion: 2 });

export interface LoadedManifestBase {
  packageName: string;
  providers: string[];
}

export interface LoadedManifestV1 extends LoadedManifestBase {
  schemaVersion: 1;
  services: Extract<LoadedManifestServiceDescriptor, { schemaVersion: 1 }>[];
}

export interface LoadedManifestV2 extends LoadedManifestBase {
  schemaVersion: 2;
  services: Extract<LoadedManifestServiceDescriptor, { schemaVersion: 2 }>[];
}

export type LoadedManifest = LoadedManifestV1 | LoadedManifestV2;

/**
 * Reads a list of manifest objects and returns aggregated service + provider module specifiers.
 *
 * @param inputs Direct manifest objects.
 * @returns Aggregated arrays of service descriptors and provider specifiers.
 */
const retrySchema = z.object({
  retries: z.number(),
  backoffMs: z.number().optional(),
  factor: z.number().optional(),
});

const manifestServiceSchemaV1 = z.object({
  importPath: z.string(),
  exportName: z.string(),
  symbolKey: z.string(),
  scope: z.enum(["singleton", "transient"]),
  deps: z.array(z.string()).default([]),
  tokenDeps: z
    .array(z.object({ exportName: z.string(), importPath: z.string() }))
    .default([]),
  lazyDeps: z
    .array(
      z.object({
        importPath: z.string(),
        exportName: z.string(),
        retry: retrySchema.optional(),
      }),
    )
    .default([]),
});

const manifestServiceSchemaV2 = z.object({
  importPath: z.string(),
  exportName: z.string(),
  symbolKey: z.string(),
  scope: z.enum(["singleton", "transient"]),
  deps: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("class"),
          exportName: z.string(),
        }),
        z.object({
          kind: z.literal("token"),
          exportName: z.string(),
          importPath: z.string(),
        }),
        z.object({
          kind: z.literal("lazy"),
          exportName: z.string(),
          importPath: z.string(),
          retry: retrySchema.optional(),
        }),
      ]),
    )
    .default([]),
});

const manifestSchemaV1 = z.object({
  schemaVersion: z.number().optional(),
  packageName: z.string(),
  services: z.array(manifestServiceSchemaV1).default([]),
  providers: z.array(z.string()).default([]),
});

const manifestSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  packageName: z.string(),
  services: z.array(manifestServiceSchemaV2).default([]),
  providers: z.array(z.string()).default([]),
});

export async function readManifests(inputs: AlloyManifest[]): Promise<{
  services: LoadedManifestServiceDescriptor[];
  providers: string[];
  loadedManifests: LoadedManifest[];
}> {
  const services: LoadedManifestServiceDescriptor[] = [];
  const providers: string[] = [];
  const loadedManifests: LoadedManifest[] = [];

  for (const manifest of inputs) {
    const parsed = readManifestByVersion(manifest);
    if (!parsed) {
      continue;
    }

    loadedManifests.push(parsed);
    for (const svc of parsed.services) {
      services.push(svc);
    }
    for (const p of parsed.providers) {
      providers.push(p);
    }
  }
  return Promise.resolve({ services, providers, loadedManifests });
}

function readManifestByVersion(manifest: AlloyManifest): LoadedManifest | null {
  const schemaVersion = manifest.schemaVersion ?? 1;
  return schemaVersion === 2
    ? readManifestV2(manifest)
    : readManifestV1(manifest);
}

function readManifestV1(manifest: AlloyManifest): LoadedManifestV1 | null {
  const parsed = manifestSchemaV1.safeParse(manifest);
  if (!parsed.success) {
    return null;
  }

  return {
    schemaVersion: 1,
    packageName: parsed.data.packageName,
    services: parsed.data.services.map((svc) => ({
      ...svc,
      schemaVersion: 1 as const,
    })),
    providers: parsed.data.providers,
  };
}

function readManifestV2(manifest: AlloyManifest): LoadedManifestV2 | null {
  const parsed = manifestSchemaV2.safeParse(manifest);
  if (!parsed.success) {
    return null;
  }

  return {
    schemaVersion: 2,
    packageName: parsed.data.packageName,
    services: parsed.data.services.map((svc) => ({
      ...svc,
      schemaVersion: 2 as const,
    })),
    providers: parsed.data.providers,
  };
}

/**
 * Groups metas by class name to support resolving dependencies that reference classes with collisions.
 *
 * @param metas Metas to index.
 * @returns Map className -> list of metas sharing that name.
 */
export function groupMetasByName(
  metas: DiscoveredMeta[],
): Map<string, DiscoveredMeta[]> {
  const byName = new Map<string, DiscoveredMeta[]>();
  for (const m of metas) {
    const list = byName.get(m.className) ?? [];
    list.push(m);
    byName.set(m.className, list);
  }
  return byName;
}

/**
 * Chooses the best meta for a dependency name when there are naming collisions.
 * Preference order:
 *  1. Exact unique match
 *  2. First meta from same package scope (prefix before first slash)
 *  3. Fallback to first candidate
 */
function selectMetaForDep(
  metasByName: Map<string, DiscoveredMeta[]>,
  depName: string,
  currentImportPath: string,
): DiscoveredMeta | undefined {
  const candidates = metasByName.get(depName);
  if (!candidates || candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const scopePrefix = currentImportPath.split("/")[0];
  const scoped = candidates.find((c) => c.filePath.startsWith(scopePrefix));
  return scoped ?? candidates[0];
}

/**
 * Converts a manifest service descriptor into a DiscoveredMeta ready for container codegen.
 * Handles:
 *  - Eager dependency identifier resolution (with aliasing)
 *  - Token dependencies inclusion
 *  - Generation of Lazy(...) expressions for lazyDeps (with optional retry config)
 *  - Recording lazy dependency keys into provided lazySet
 *
 * @param svc Manifest descriptor
 * @param metasByName Grouped metas for duplicate resolution
 * @param resolver Collision-aware identifier resolver
 * @param lazySet Target set tracking lazy-only class keys
 */
export function toMetaFromManifest(
  svc: LoadedManifestServiceDescriptor,
  metasByName: Map<string, DiscoveredMeta[]>,
  resolver: IdentifierResolver,
  lazySet: Set<string>,
): DiscoveredMeta {
  const deps: DependencyDescriptor[] = [];
  const referencedImports: {
    name: string;
    path: string;
    originalName?: string;
  }[] = [];

  if (svc.schemaVersion === 2) {
    appendDependenciesFromManifestV2(
      svc,
      deps,
      referencedImports,
      metasByName,
      resolver,
      lazySet,
    );
  } else {
    appendDependenciesFromManifestV1(
      svc,
      deps,
      referencedImports,
      metasByName,
      resolver,
      lazySet,
    );
  }

  const metadata: ServiceMetadata = {
    scope: svc.scope,
    dependencies: deps,
  };

  return {
    className: svc.exportName,
    filePath: svc.importPath,
    identifierKey: svc.symbolKey,
    metadata,
    referencedImports,
  };
}

function appendDependenciesFromManifestV1(
  svc: Extract<LoadedManifestServiceDescriptor, { schemaVersion: 1 }>,
  deps: DependencyDescriptor[],
  referencedImports: {
    name: string;
    path: string;
    originalName?: string;
  }[],
  metasByName: Map<string, DiscoveredMeta[]>,
  resolver: IdentifierResolver,
  lazySet: Set<string>,
): void {
  for (const depName of svc.deps ?? []) {
    deps.push(
      createClassOrTokenDependency(
        depName,
        svc.importPath,
        metasByName,
        resolver,
      ),
    );
  }

  if (Array.isArray(svc.tokenDeps)) {
    for (const tok of svc.tokenDeps) {
      deps.push({
        expression: tok.exportName,
        referencedIdentifiers: [tok.exportName],
        isLazy: false,
      });
      referencedImports.push({
        name: tok.exportName,
        path: tok.importPath,
        originalName: tok.exportName,
      });
    }
  }

  for (const lazy of svc.lazyDeps ?? []) {
    deps.push(createLazyDependencyDescriptor(lazy));
    lazySet.add(createClassKey(lazy.importPath, lazy.exportName));
  }
}

function appendDependenciesFromManifestV2(
  svc: Extract<LoadedManifestServiceDescriptor, { schemaVersion: 2 }>,
  deps: DependencyDescriptor[],
  referencedImports: {
    name: string;
    path: string;
    originalName?: string;
  }[],
  metasByName: Map<string, DiscoveredMeta[]>,
  resolver: IdentifierResolver,
  lazySet: Set<string>,
): void {
  for (const dep of svc.deps) {
    appendV2Dependency(
      dep,
      svc.importPath,
      deps,
      referencedImports,
      metasByName,
      resolver,
      lazySet,
    );
  }
}

function appendV2Dependency(
  dep: ManifestDependencyEntry,
  currentImportPath: string,
  deps: DependencyDescriptor[],
  referencedImports: {
    name: string;
    path: string;
    originalName?: string;
  }[],
  metasByName: Map<string, DiscoveredMeta[]>,
  resolver: IdentifierResolver,
  lazySet: Set<string>,
): void {
  if (dep.kind === "class") {
    deps.push(
      createClassOrTokenDependency(
        dep.exportName,
        currentImportPath,
        metasByName,
        resolver,
      ),
    );
    return;
  }

  if (dep.kind === "token") {
    deps.push({
      expression: dep.exportName,
      referencedIdentifiers: [dep.exportName],
      isLazy: false,
    });
    referencedImports.push({
      name: dep.exportName,
      path: dep.importPath,
      originalName: dep.exportName,
    });
    return;
  }

  deps.push(createLazyDependencyDescriptor(dep));
  lazySet.add(createClassKey(dep.importPath, dep.exportName));
}

function createClassOrTokenDependency(
  depName: string,
  currentImportPath: string,
  metasByName: Map<string, DiscoveredMeta[]>,
  resolver: IdentifierResolver,
): DependencyDescriptor {
  const targetMeta = selectMetaForDep(metasByName, depName, currentImportPath);
  if (targetMeta) {
    const expression = resolver.resolve(
      targetMeta.className,
      targetMeta.filePath,
    );
    return {
      expression,
      referencedIdentifiers: [expression],
      isLazy: false,
    };
  }

  return {
    expression: depName,
    referencedIdentifiers: [depName],
    isLazy: false,
  };
}

function createLazyDependencyDescriptor(
  lazy: Pick<
    Extract<ManifestDependencyEntry, { kind: "lazy" }>,
    "exportName" | "importPath" | "retry"
  >,
): DependencyDescriptor {
  const importer = `() => import('${lazy.importPath}').then(m => m.${lazy.exportName})`;
  let expression = `Lazy(${importer})`;
  if (lazy.retry) {
    const opts: string[] = [`retries: ${lazy.retry.retries}`];
    if (typeof lazy.retry.backoffMs === "number") {
      opts.push(`backoffMs: ${lazy.retry.backoffMs}`);
    }
    if (typeof lazy.retry.factor === "number") {
      opts.push(`factor: ${lazy.retry.factor}`);
    }
    expression = `Lazy(${importer}, { ${opts.join(", ")} })`;
  }

  return {
    expression,
    referencedIdentifiers: [],
    isLazy: true,
  };
}

/**
 * Extracts class names referenced eagerly (not wrapped in Lazy) from meta metadata blocks.
 * This allows distinguishing services that must remain in static import set.
 *
 * @param metas All metas to scan.
 * @returns Set of class names with at least one eager reference.
 */
export function collectEagerReferencedNames(
  metas: DiscoveredMeta[],
): Set<string> {
  const eager = new Set<string>();
  for (const meta of metas) {
    for (const dep of meta.metadata.dependencies) {
      if (!dep.isLazy) {
        for (const id of dep.referencedIdentifiers) {
          eager.add(id);
        }
      }
    }
  }
  return eager;
}

/**
 * Removes any service key from lazySet if the service is also referenced eagerly.
 * A service is only lazy-only if ALL references are lazy.
 */
export function reconcileLazySet(
  metas: DiscoveredMeta[],
  lazySet: Set<string>,
  eagerNames: Set<string>,
) {
  for (const meta of metas) {
    if (eagerNames.has(meta.className)) {
      const key = createClassKey(meta.filePath, meta.className);
      lazySet.delete(key);
    }
  }
}

/**
 * Adds a factory-lazy wrapper to services configured via plugin option `lazyServices`.
 * Injects a `factory: Lazy(() => import(...))` property into the metadata.
 * Safely skips metas already containing a factory property.
 */
export function augmentFactoryLazyServices(
  metas: DiscoveredMeta[],
  lazyServiceKeys: Set<string>,
) {
  for (const m of metas) {
    const identifierKey =
      m.identifierKey ?? createSymbolKey(m.filePath, m.className);
    if (!lazyServiceKeys.has(identifierKey)) {
      continue;
    }
    if (m.metadata.factory) {
      continue;
    }
    const rawPath = m.filePath.startsWith("/@")
      ? m.filePath.slice(1)
      : m.filePath;
    const isBare = !/^(\.|\/|[A-Za-z]:\\)/.test(rawPath);
    const importPath = isBare ? rawPath : normalizeImportPath(m.filePath);
    const sanitizedImportPath = importPath.startsWith("/@")
      ? importPath.slice(1)
      : importPath;
    const factoryExpr = `Lazy(() => import('${sanitizedImportPath}').then(m => m.${m.className}))`;

    m.metadata.factory = {
      expression: factoryExpr,
      referencedIdentifiers: [],
      isLazy: true,
    };
  }
}

/**
 * Detects duplicate service registrations between locally discovered metas and ingested manifests.
 * Returns structured info for error reporting.
 */
export function findDuplicateManifestServices(
  localMetas: DiscoveredMeta[],
  manifestServices: LoadedManifestServiceDescriptor[],
): { exportName: string; localPaths: string[]; manifestImport: string }[] {
  const localMetasByIdentifier = new Map<string, DiscoveredMeta[]>();
  for (const meta of localMetas) {
    const identifierKey =
      meta.identifierKey ?? createSymbolKey(meta.filePath, meta.className);
    const matches = localMetasByIdentifier.get(identifierKey) ?? [];
    matches.push(meta);
    localMetasByIdentifier.set(identifierKey, matches);
  }

  return manifestServices.flatMap((svc) => {
    const matches = localMetasByIdentifier.get(svc.symbolKey);
    if (!matches?.length) {
      return [];
    }

    return [
      {
        exportName: svc.exportName,
        localPaths: matches.map((m) => normalizeImportPath(m.filePath)),
        manifestImport: svc.importPath,
      },
    ];
  });
}

import { z } from "zod";
import {
  createClassKey,
  createSymbolKey,
  normalizeImportPath,
} from "../core/utils";
import type {
  AlloyManifest,
  DiscoveredMeta,
  ManifestServiceDescriptor,
  DependencyDescriptor,
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

export interface LoadedManifest {
  packageName: string;
  services: ManifestServiceDescriptor[];
  providers: string[];
}

/**
 * Reads a list of manifest objects and returns aggregated service + provider module specifiers.
 *
 * @param inputs Direct manifest objects.
 * @returns Aggregated arrays of service descriptors and provider specifiers.
 */
export async function readManifests(inputs: AlloyManifest[]): Promise<{
  services: ManifestServiceDescriptor[];
  providers: string[];
  loadedManifests: LoadedManifest[];
}> {
  const services: ManifestServiceDescriptor[] = [];
  const providers: string[] = [];
  const loadedManifests: LoadedManifest[] = [];

  const manifestSchema = z.object({
    schemaVersion: z.number().optional(),
    packageName: z.string(),
    services: z
      .array(
        z.object({
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
                retry: z
                  .object({
                    retries: z.number(),
                    backoffMs: z.number().optional(),
                    factor: z.number().optional(),
                  })
                  .optional(),
              }),
            )
            .default([]),
        }),
      )
      .default([]),
    providers: z.array(z.string()).default([]),
  });

  for (const manifest of inputs) {
    const parsed = manifestSchema.safeParse(manifest);
    if (!parsed.success) {
      // Skip invalid manifests
      continue;
    }

    loadedManifests.push({
      packageName: parsed.data.packageName,
      // oxlint-disable-next-line: no-unsafe-type-assertion
      services: parsed.data.services as ManifestServiceDescriptor[],
      providers: parsed.data.providers,
    });

    for (const svc of parsed.data.services) {
      // oxlint-disable-next-line: no-unsafe-type-assertion
      services.push(svc as ManifestServiceDescriptor);
    }
    for (const p of parsed.data.providers) {
      providers.push(p);
    }
  }
  return Promise.resolve({ services, providers, loadedManifests });
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
  svc: ManifestServiceDescriptor,
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

  for (const depName of svc.deps ?? []) {
    const targetMeta = selectMetaForDep(metasByName, depName, svc.importPath);
    if (targetMeta) {
      const expression = resolver.resolve(
        targetMeta.className,
        targetMeta.filePath,
      );
      deps.push({
        expression,
        referencedIdentifiers: [expression],
        isLazy: false,
      });
    } else {
      // Fallback: assume it's available globally or handled elsewhere?
      // If it's not in metas, it might be a token or external.
      // Manifests should list tokenDeps separately.
      // If it's a class from another library not in manifests, we can't resolve it.
      // We assume depName is sufficient.
      deps.push({
        expression: depName,
        referencedIdentifiers: [depName],
        isLazy: false,
      });
    }
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
    const importer = `() => import('${lazy.importPath}').then(m => m.${lazy.exportName})`;
    let expr: string;
    if (lazy.retry) {
      const opts: string[] = [`retries: ${lazy.retry.retries}`];
      if (typeof lazy.retry.backoffMs === "number") {
        opts.push(`backoffMs: ${lazy.retry.backoffMs}`);
      }
      if (typeof lazy.retry.factor === "number") {
        opts.push(`factor: ${lazy.retry.factor}`);
      }
      expr = `Lazy(${importer}, { ${opts.join(", ")} })`;
    } else {
      expr = `Lazy(${importer})`;
    }
    deps.push({
      expression: expr,
      referencedIdentifiers: [],
      isLazy: true,
    });
    lazySet.add(createClassKey(lazy.importPath, lazy.exportName));
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
  manifestServices: ManifestServiceDescriptor[],
): { exportName: string; localPaths: string[]; manifestImport: string }[] {
  const discoveredNames = new Set(localMetas.map((m) => m.className));
  const duplicates = manifestServices.filter((svc) =>
    discoveredNames.has(svc.exportName),
  );
  return duplicates.map((d) => ({
    exportName: d.exportName,
    localPaths: localMetas
      .filter((m) => m.className === d.exportName)
      .map((m) => normalizeImportPath(m.filePath)),
    manifestImport: d.importPath,
  }));
}

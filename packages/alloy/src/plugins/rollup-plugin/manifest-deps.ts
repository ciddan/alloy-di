import path from "node:path";
import { resolveImportPathForBuild, type BuildMode } from "./build-utils";
import {
  parseLazyDependencyExpression,
  resolveModuleSpecifierCandidates,
} from "../core/lazy";
import type {
  DependencyDescriptor,
  DiscoveredMeta,
  ManifestDependencyEntry,
} from "../core/types";
import {
  getDependencyImports,
  getDependencyReferenceName,
  resolveClassDependencyName,
} from "./dependency-resolution";

/**
 * Resolve a dependency's module specifier to its public import path.
 * Relative/absolute specifiers map through the build-mode rules; bare
 * specifiers (e.g. another package) pass through unchanged.
 */
function resolveDependencyImportPath(
  specifier: string,
  sourceFilePath: string,
  packageName: string,
  buildMode: BuildMode,
): string {
  if (specifier.startsWith(".")) {
    const resolvedCandidates = resolveModuleSpecifierCandidates(
      sourceFilePath,
      specifier,
    );
    const targetPath =
      resolvedCandidates[0] ??
      path.resolve(path.dirname(sourceFilePath), specifier);
    return resolveImportPathForBuild(targetPath, packageName, buildMode);
  }
  if (path.isAbsolute(specifier)) {
    return resolveImportPathForBuild(specifier, packageName, buildMode);
  }
  return specifier;
}

function createTokenDependency(
  dep: DependencyDescriptor,
  meta: DiscoveredMeta,
  packageName: string,
  buildMode: BuildMode,
): Extract<ManifestDependencyEntry, { kind: "token" }> {
  const imports = getDependencyImports(meta, dep);
  const preferredImport = imports.find((entry) => entry.originalName !== "*");
  const exportName =
    preferredImport?.originalName ??
    getDependencyReferenceName(dep.expression) ??
    dep.referencedIdentifiers[0] ??
    dep.expression;
  const importPath = preferredImport
    ? resolveDependencyImportPath(
        preferredImport.path,
        meta.filePath,
        packageName,
        buildMode,
      )
    : packageName;

  return {
    kind: "token",
    exportName,
    importPath,
  };
}

/**
 * Build a single manifest dependency entry (lazy / class / token) for a
 * discovered service's dependency descriptor.
 */
export function createManifestDependency(
  dep: DependencyDescriptor,
  meta: DiscoveredMeta,
  knownServiceNames: Set<string>,
  packageName: string,
  buildMode: BuildMode,
): ManifestDependencyEntry | null {
  if (dep.isLazy) {
    const parsedLazy = parseLazyDependencyExpression(
      dep.expression,
      meta.filePath,
    );
    if (!parsedLazy) {
      return null;
    }
    const entry: Extract<ManifestDependencyEntry, { kind: "lazy" }> = {
      kind: "lazy",
      exportName: parsedLazy.exportName,
      importPath: resolveDependencyImportPath(
        parsedLazy.specifier,
        meta.filePath,
        packageName,
        buildMode,
      ),
    };
    if (parsedLazy.retry) {
      entry.retry = parsedLazy.retry;
    }
    return entry;
  }

  const className = resolveClassDependencyName(dep, meta, knownServiceNames);
  if (className) {
    return { kind: "class", exportName: className };
  }

  return createTokenDependency(dep, meta, packageName, buildMode);
}

import type { ViteDevServer } from "vite";
import { createDiscoveryStore } from "../core/discovery-store";
import type { DiscoveredMeta } from "../core/types";
import { createClassKey } from "../core/utils";

/** Files the discovery scanner processes (mirrors the transform hook filter). */
export function isDiscoverableFile(file: string): boolean {
  return (
    /\.tsx?$/i.test(file) &&
    !/\.d\.ts$/i.test(file) &&
    !file.includes("node_modules")
  );
}

/**
 * Serializes the codegen-relevant fields of a file's discovered metas so two
 * scans can be compared. Changes here (added/removed services, scope, deps,
 * factory, or resolved imports) mean the generated container must be rebuilt;
 * edits that leave them untouched (e.g. a method body) should not.
 */
function metasSignature(metas: readonly DiscoveredMeta[]): string {
  return JSON.stringify(
    metas.map((m) => ({
      className: m.className,
      filePath: m.filePath,
      scope: m.metadata.scope,
      factory: m.metadata.factory?.expression ?? null,
      dependencies: m.metadata.dependencies.map((d) => ({
        expression: d.expression,
        isLazy: d.isLazy,
        referencedIdentifiers: d.referencedIdentifiers,
      })),
      referencedImports: (m.referencedImports ?? []).map((r) => ({
        name: r.name,
        path: r.path,
        originalName: r.originalName ?? null,
        isTypeOnly: Boolean(r.isTypeOnly),
      })),
    })),
  );
}

function lazyKeysSignature(keys: Set<string> | undefined): string {
  if (!keys || keys.size === 0) {
    return "";
  }
  return Array.from(keys).toSorted().join("|");
}

export interface DiscoveryRuntime {
  readonly discoveredClasses: Map<string, DiscoveredMeta>;
  readonly lazyReferencedClassKeys: Set<string>;
  processUpdate(id: string, code: string): boolean;
  removeDiscoveredFile(file: string): boolean;
  clear(): void;
}

export function createDiscoveryRuntime(): DiscoveryRuntime {
  const discovery = createDiscoveryStore();
  const discoveredClasses = new Map<string, DiscoveredMeta>();
  const lazyReferencedClassKeys = new Set<string>();

  return {
    discoveredClasses,
    lazyReferencedClassKeys,
    processUpdate(id: string, code: string): boolean {
      const { metas, lazyClassKeys, previousMetas, previousLazyClassKeys } =
        discovery.updateFile(id, code);

      if (previousMetas) {
        for (const meta of previousMetas) {
          discoveredClasses.delete(
            createClassKey(meta.filePath, meta.className),
          );
        }
      }

      for (const meta of metas) {
        discoveredClasses.set(
          createClassKey(meta.filePath, meta.className),
          meta,
        );
      }

      if (previousLazyClassKeys) {
        for (const key of previousLazyClassKeys) {
          lazyReferencedClassKeys.delete(key);
        }
      }
      if (lazyClassKeys.size) {
        for (const key of lazyClassKeys) {
          lazyReferencedClassKeys.add(key);
        }
      }

      return (
        metasSignature(previousMetas ?? []) !== metasSignature(metas) ||
        lazyKeysSignature(previousLazyClassKeys) !==
          lazyKeysSignature(lazyClassKeys)
      );
    },
    removeDiscoveredFile(file: string): boolean {
      const removed = discovery.removeFile(file);
      if (removed.previousMetas) {
        for (const meta of removed.previousMetas) {
          discoveredClasses.delete(
            createClassKey(meta.filePath, meta.className),
          );
        }
      }
      if (removed.previousLazyClassKeys) {
        for (const key of removed.previousLazyClassKeys) {
          lazyReferencedClassKeys.delete(key);
        }
      }
      return Boolean(
        removed.previousMetas?.length || removed.previousLazyClassKeys?.size,
      );
    },
    clear(): void {
      discovery.clear();
      discoveredClasses.clear();
      lazyReferencedClassKeys.clear();
    },
  };
}

/**
 * Invalidate the generated container module in every environment's module
 * graph so its `load` hook re-runs and regenerates from current discovery.
 */
export function invalidateContainerModule(
  server: ViteDevServer,
  resolvedVirtualModuleId: string,
): void {
  for (const environment of Object.values(server.environments)) {
    const mod = environment.moduleGraph.getModuleById(resolvedVirtualModuleId);
    if (mod) {
      environment.moduleGraph.invalidateModule(mod);
    }
  }
}

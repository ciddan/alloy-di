import { createDiscoveryStore } from "./discovery-store";
import type { DiscoveredMeta, FactoryProviderMeta } from "./types";
import { createClassKey } from "./utils";

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

function factoryProvidersSignature(
  providers: readonly FactoryProviderMeta[] | undefined,
): string {
  return JSON.stringify(
    (providers ?? []).map((provider) => ({
      filePath: provider.filePath,
      tokenExpression: provider.tokenExpression,
      tokenLabel: provider.tokenLabel,
      lifecycle: provider.lifecycle,
    })),
  );
}

export interface DiscoveryRuntime {
  readonly discoveredClasses: Map<string, DiscoveredMeta>;
  readonly lazyReferencedClassKeys: Set<string>;
  readonly factoryProvidersByFile: Map<string, FactoryProviderMeta[]>;
  processUpdate(
    id: string,
    code: string,
    options?: { factoryProviders?: boolean },
  ): boolean;
  removeDiscoveredFile(file: string): boolean;
  clear(): void;
}

export function createDiscoveryRuntime(): DiscoveryRuntime {
  const discovery = createDiscoveryStore();
  const discoveredClasses = new Map<string, DiscoveredMeta>();
  const lazyReferencedClassKeys = new Set<string>();
  const factoryProvidersByFile = new Map<string, FactoryProviderMeta[]>();

  return {
    discoveredClasses,
    lazyReferencedClassKeys,
    factoryProvidersByFile,
    processUpdate(
      id: string,
      code: string,
      options?: { factoryProviders?: boolean },
    ): boolean {
      const trackFactoryProviders = options?.factoryProviders ?? true;
      const {
        metas,
        lazyClassKeys,
        factoryProviders,
        previousMetas,
        previousLazyClassKeys,
        previousFactoryProviders,
      } = discovery.updateFile(id, code, {
        factoryProviders: trackFactoryProviders,
      });

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

      if (trackFactoryProviders && factoryProviders.length) {
        factoryProvidersByFile.set(id, factoryProviders);
      } else {
        factoryProvidersByFile.delete(id);
      }

      return (
        metasSignature(previousMetas ?? []) !== metasSignature(metas) ||
        lazyKeysSignature(previousLazyClassKeys) !==
          lazyKeysSignature(lazyClassKeys) ||
        (trackFactoryProviders &&
          factoryProvidersSignature(previousFactoryProviders) !==
            factoryProvidersSignature(factoryProviders))
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
      factoryProvidersByFile.delete(file);
      return Boolean(
        removed.previousMetas?.length ||
        removed.previousLazyClassKeys?.size ||
        removed.previousFactoryProviders?.length,
      );
    },
    clear(): void {
      discovery.clear();
      discoveredClasses.clear();
      lazyReferencedClassKeys.clear();
      factoryProvidersByFile.clear();
    },
  };
}

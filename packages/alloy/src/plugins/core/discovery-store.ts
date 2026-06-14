/**
 * Maintains a per-file cache of discovered DI metadata, lazy references, and
 * optionally source snapshots to drive incremental recompilation inside the
 * Alloy discovery pipeline.
 */

import crypto from "node:crypto";
import { scanSource } from "./scanner";
import type { DiscoveredMeta, FactoryProviderMeta } from "./types";

function hashContent(code: string): string {
  return crypto.createHash("sha1").update(code).digest("hex");
}

export interface DiscoveryStoreUpdateOptions {
  factoryProviders?: boolean;
}

export interface DiscoveryStoreOptions {
  trackSources?: boolean;
}

export interface DiscoveryStoreUpdate {
  metas: DiscoveredMeta[];
  lazyClassKeys: Set<string>;
  factoryProviders: FactoryProviderMeta[];
  previousMetas?: DiscoveredMeta[];
  previousLazyClassKeys?: Set<string>;
  previousFactoryProviders?: FactoryProviderMeta[];
}

export interface DiscoveryStoreRemoval {
  previousMetas?: DiscoveredMeta[];
  previousLazyClassKeys?: Set<string>;
  previousFactoryProviders?: FactoryProviderMeta[];
}

export interface DiscoveryStore {
  readonly fileMetas: Map<string, DiscoveredMeta[]>;
  readonly fileLazyRefs: Map<string, Set<string>>;
  readonly fileFactoryProviders: Map<string, FactoryProviderMeta[]>;
  readonly fileSources?: Map<string, string>;
  updateFile(
    id: string,
    code: string,
    options?: DiscoveryStoreUpdateOptions,
  ): DiscoveryStoreUpdate;
  removeFile(id: string): DiscoveryStoreRemoval;
  clear(): void;
}

/**
 * Creates a file-scoped discovery store that caches scanner output and
 * optionally the original source for diagnostics or incremental rebuilds.
 *
 * @param options.trackSources - When true, persist the full source text.
 * @returns An object exposing cache maps plus mutation helpers.
 */
export function createDiscoveryStore(
  options: DiscoveryStoreOptions = {},
): DiscoveryStore {
  const fileMetas = new Map<string, DiscoveredMeta[]>();
  const fileLazyRefs = new Map<string, Set<string>>();
  const fileFactoryProviders = new Map<string, FactoryProviderMeta[]>();
  const fileContentHashes = new Map<string, string>();
  const fileSources = options.trackSources
    ? new Map<string, string>()
    : undefined;

  /**
   * Scan and cache the latest metadata for a file, returning both the fresh
   * scan results and whatever was previously stored for diff consumers.
   *
   * @param id - Module identifier or path.
   * @param code - Current file contents to analyze.
   */
  function updateFile(
    id: string,
    code: string,
    options?: DiscoveryStoreUpdateOptions,
  ): DiscoveryStoreUpdate {
    const scanFactoryProviders = options?.factoryProviders ?? true;
    const previousMetas = fileMetas.get(id);
    const previousLazyClassKeys = fileLazyRefs.get(id);
    const previousFactoryProviders = fileFactoryProviders.get(id);

    // Identical content yields identical scan results, so serve them from
    // the cache.
    const contentHash = hashContent(
      `${scanFactoryProviders ? "factory:1" : "factory:0"}\0${code}`,
    );
    if (fileContentHashes.get(id) === contentHash) {
      return {
        metas: previousMetas ?? [],
        lazyClassKeys: new Set(previousLazyClassKeys),
        factoryProviders: previousFactoryProviders ?? [],
        previousMetas,
        previousLazyClassKeys,
        previousFactoryProviders,
      };
    }
    fileContentHashes.set(id, contentHash);

    if (fileSources) {
      fileSources.set(id, code);
    }

    const { metas, lazyClassKeys, factoryProviders } = scanSource(code, id, {
      factoryProviders: scanFactoryProviders,
    });

    if (metas.length) {
      fileMetas.set(id, metas);
    } else {
      fileMetas.delete(id);
    }

    if (lazyClassKeys.size) {
      fileLazyRefs.set(id, lazyClassKeys);
    } else {
      fileLazyRefs.delete(id);
    }

    if (factoryProviders.length) {
      fileFactoryProviders.set(id, factoryProviders);
    } else {
      fileFactoryProviders.delete(id);
    }

    return {
      metas,
      lazyClassKeys,
      factoryProviders,
      previousMetas,
      previousLazyClassKeys,
      previousFactoryProviders,
    };
  }

  /**
   * Purge all cached information for a given file.
   *
   * @param id - Module identifier or path being removed.
   */
  function removeFile(id: string): DiscoveryStoreRemoval {
    const previousMetas = fileMetas.get(id);
    const previousLazyClassKeys = fileLazyRefs.get(id);
    const previousFactoryProviders = fileFactoryProviders.get(id);
    fileMetas.delete(id);
    fileLazyRefs.delete(id);
    fileFactoryProviders.delete(id);
    fileContentHashes.delete(id);
    if (fileSources) {
      fileSources.delete(id);
    }
    return {
      previousMetas,
      previousLazyClassKeys,
      previousFactoryProviders,
    };
  }

  /**
   * Clear every cached entry, including optional source snapshots.
   */
  function clear(): void {
    fileMetas.clear();
    fileLazyRefs.clear();
    fileFactoryProviders.clear();
    fileContentHashes.clear();
    fileSources?.clear();
  }

  return {
    fileMetas,
    fileLazyRefs,
    fileFactoryProviders,
    fileSources,
    updateFile,
    removeFile,
    clear,
  };
}

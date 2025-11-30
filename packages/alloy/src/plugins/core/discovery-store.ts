/**
 * Maintains a per-file cache of discovered DI metadata, lazy references, and
 * optionally source snapshots to drive incremental recompilation inside the
 * Alloy discovery pipeline.
 */

import { scanSource } from "../core/scanner";
import type { DiscoveredMeta } from "../core/types";

export interface DiscoveryStoreOptions {
  trackSources?: boolean;
}

export interface DiscoveryStoreUpdate {
  metas: DiscoveredMeta[];
  lazyClassKeys: Set<string>;
  previousMetas?: DiscoveredMeta[];
  previousLazyClassKeys?: Set<string>;
}

export interface DiscoveryStoreRemoval {
  previousMetas?: DiscoveredMeta[];
  previousLazyClassKeys?: Set<string>;
}

export interface DiscoveryStore {
  readonly fileMetas: Map<string, DiscoveredMeta[]>;
  readonly fileLazyRefs: Map<string, Set<string>>;
  readonly fileSources?: Map<string, string>;
  updateFile(id: string, code: string): DiscoveryStoreUpdate;
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
  function updateFile(id: string, code: string): DiscoveryStoreUpdate {
    const previousMetas = fileMetas.get(id);
    const previousLazyClassKeys = fileLazyRefs.get(id);

    if (fileSources) {
      fileSources.set(id, code);
    }

    const { metas, lazyClassKeys } = scanSource(code, id);

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

    return { metas, lazyClassKeys, previousMetas, previousLazyClassKeys };
  }

  /**
   * Purge all cached information for a given file.
   *
   * @param id - Module identifier or path being removed.
   */
  function removeFile(id: string): DiscoveryStoreRemoval {
    const previousMetas = fileMetas.get(id);
    const previousLazyClassKeys = fileLazyRefs.get(id);
    fileMetas.delete(id);
    fileLazyRefs.delete(id);
    if (fileSources) {
      fileSources.delete(id);
    }
    return { previousMetas, previousLazyClassKeys };
  }

  /**
   * Clear every cached entry, including optional source snapshots.
   */
  function clear(): void {
    fileMetas.clear();
    fileLazyRefs.clear();
    fileSources?.clear();
  }

  return {
    fileMetas,
    fileLazyRefs,
    fileSources,
    updateFile,
    removeFile,
    clear,
  };
}

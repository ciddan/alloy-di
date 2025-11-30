import path from "node:path";
import { normalizeImportPath } from "../core/utils";

/**
 * Enumeration of supported build output strategies for Alloy manifests.
 * - preserve-modules: one output file per source file; supports stable subpath imports.
 * - chunks: multiple entry chunks (no preserveModules) when >1 service discovered.
 * - bundled: single bundle exposing all services from package root.
 */
export type BuildMode = "preserve-modules" | "chunks" | "bundled";

/**
 * Determines build mode from Rollup/Rolldown output configuration + count of discovered services.
 * Logic: preserveModules wins first; otherwise if >1 service we treat as chunked; else bundled.
 *
 * @param preserveModules Whether the bundler output preserves modules (Rollup output.preserveModules).
 * @param discoveredServiceCount Total number of decorated Alloy services found during scanning.
 * @returns Resolved BuildMode used for import path derivation and manifest shape.
 */
export function determineBuildMode(
  preserveModules: boolean,
  discoveredServiceCount: number,
): BuildMode {
  if (preserveModules) {
    return "preserve-modules";
  }
  const isChunks = !preserveModules && discoveredServiceCount > 1;
  return isChunks ? "chunks" : "bundled";
}

/**
 * Derives the public import path for a source file based on build mode.
 *
 * Rules:
 *  - preserve-modules: subpath mirrors /src/ relative path with extension stripped.
 *  - chunks: base filename becomes the subpath (extension stripped).
 *  - bundled: all services accessible from the package root (no subpath suffix).
 *
 * @param targetPath Absolute filesystem path of the source file defining the service.
 * @param packageName NPM package name as resolved from library package.json.
 * @param buildMode Previously resolved build mode.
 * @returns Public import specifier consumers will use (e.g. `@scope/pkg/service-a`).
 */
export function resolveImportPathForBuild(
  targetPath: string,
  packageName: string,
  buildMode: BuildMode,
): string {
  const normalized = normalizeImportPath(targetPath);
  if (buildMode === "preserve-modules") {
    const srcIndex = normalized.lastIndexOf("/src/");
    if (srcIndex !== -1) {
      let sub = normalized.slice(srcIndex + "/src/".length);
      // Strip file extension to form stable ESM subpath.
      sub = sub.replace(/\.(tsx?|ts|js|jsx|mts|cts)$/i, "");
      return `${packageName}/${sub}`;
    }
    return packageName;
  }
  if (buildMode === "chunks") {
    const base = path
      .basename(targetPath)
      .replace(/\.(tsx?|ts|js|jsx|mts|cts)$/i, "");
    return `${packageName}/${base}`;
  }
  // bundled
  return packageName;
}

export function hasPreserveModules(
  o: unknown,
): o is { preserveModules?: boolean } {
  return typeof o === "object" && o !== null && "preserveModules" in o;
}

import fs from "node:fs";
import path from "node:path";
import type { ServiceIdentifier } from "../../lib/service-identifiers";
import {
  createDiscoveryRuntime,
  type DiscoveryRuntime,
} from "./discovery-runtime";
import { walkSync } from "./utils";

export const DEFAULT_SOURCE_DIRS = ["src"] as const;

export function toLazyServiceKey(identifier: ServiceIdentifier): string {
  const description = identifier.description;
  if (!description || !description.startsWith("alloy:")) {
    throw new Error(
      "[alloy] lazyServices entries must be serviceIdentifiers exported by Alloy manifests.",
    );
  }
  return description;
}

export function readPackageName(root: string): string {
  try {
    const pkgPath = path.resolve(root, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.name === "string") {
      return pkg.name;
    }
  } catch {
    // fall through to legacy default
  }
  return "UNKNOWN_PACKAGE";
}

export interface ScanSourceDirectoriesOptions {
  factoryProviders?: boolean;
}

function isSourceFile(file: string): boolean {
  return /\.tsx?$/i.test(file) && !file.endsWith(".d.ts");
}

export function scanSourceDirectories(
  discoveryRuntime: DiscoveryRuntime,
  root: string,
  sourceDirs: readonly string[] = DEFAULT_SOURCE_DIRS,
  options?: ScanSourceDirectoriesOptions,
): void {
  for (const sourceDir of sourceDirs) {
    const resolvedSourceDir = path.isAbsolute(sourceDir)
      ? sourceDir
      : path.resolve(root, sourceDir);
    const files = walkSync(resolvedSourceDir);

    for (const file of files) {
      if (!isSourceFile(file)) {
        continue;
      }

      try {
        const code = fs.readFileSync(file, "utf-8");
        discoveryRuntime.processUpdate(file, code, options);
      } catch {
        // Ignore files that disappear or become unreadable during generation.
      }
    }
  }
}

export function createDiscoveryRuntimeForSourceDirs(
  root: string,
  sourceDirs: readonly string[] = DEFAULT_SOURCE_DIRS,
  options?: ScanSourceDirectoriesOptions,
): DiscoveryRuntime {
  const discoveryRuntime = createDiscoveryRuntime();
  scanSourceDirectories(discoveryRuntime, root, sourceDirs, options);
  return discoveryRuntime;
}

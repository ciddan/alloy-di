import path from "node:path";
import type { AlloyPluginOptions } from "./plugins/vite-plugin";
import {
  prepareContainerData,
  writeDeclarationArtifacts,
} from "./plugins/core/container-loader";
import {
  DEFAULT_SOURCE_DIRS,
  createDiscoveryRuntimeForSourceDirs,
  readPackageName,
  toLazyServiceKey,
} from "./plugins/core/generation-inputs";
import { normalizeImportPath } from "./plugins/core/utils";

export interface AlloyGenerateOptions extends AlloyPluginOptions {
  /**
   * Project root to scan. Defaults to `process.cwd()`.
   */
  root?: string;
  /**
   * Override the package name used for generated service identifier keys.
   * Defaults to the nearest `package.json` name under `root`.
   */
  packageName?: string;
}

export interface AlloyGenerateResult {
  root: string;
  declarationDir: string;
  serviceCount: number;
  manifestCount: number;
}

/**
 * Generates Alloy's ambient TypeScript declarations without running a Vite
 * build. This is intended for fresh checkouts and CI pipelines that type-check
 * before bundling.
 */
export async function generate(
  options: AlloyGenerateOptions = {},
): Promise<AlloyGenerateResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const packageName = options.packageName ?? readPackageName(root);
  const discoveryRuntime = createDiscoveryRuntimeForSourceDirs(
    root,
    options.sourceDirs ?? DEFAULT_SOURCE_DIRS,
    { factoryProviders: false },
  );
  const providerImportPaths = (options.providers ?? []).map((entry) => {
    const absPath = path.isAbsolute(entry) ? entry : path.resolve(root, entry);
    return normalizeImportPath(absPath);
  });

  const prepared = await prepareContainerData({
    localMetas: Array.from(discoveryRuntime.discoveredClasses.values()),
    lazyReferencedClassKeys: discoveryRuntime.lazyReferencedClassKeys,
    manifests: options.manifests ?? [],
    providerImportPaths,
    factoryProviders: [],
    lazyServiceKeys: new Set(
      (options.lazyServices ?? []).map(toLazyServiceKey),
    ),
    packageName,
    resolvedRoot: root,
    containerDeclarationDir: options.containerDeclarationDir,
    resolvedVisualization: null,
    scopes: options.scopes,
  });

  writeDeclarationArtifacts({
    metas: prepared.metas,
    loadedManifests: prepared.loadedManifests,
    resolvedRoot: root,
    containerDeclarationDir: options.containerDeclarationDir,
    scopes: options.scopes,
  });

  return {
    root,
    declarationDir: path.resolve(
      root,
      options.containerDeclarationDir ?? "./src",
    ),
    serviceCount: prepared.metas.length,
    manifestCount: prepared.loadedManifests.length,
  };
}

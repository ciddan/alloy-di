import fs from "node:fs";
import path from "node:path";
import type { ServiceIdentifier } from "../lib/service-identifiers";
import type { AlloyManifest } from "./core/types";
import { loadVirtualContainerModule } from "./core/container-loader";
import {
  createDiscoveryRuntime,
  isDiscoverableFile,
} from "./core/discovery-runtime";
import {
  DEFAULT_SOURCE_DIRS,
  readPackageName,
  scanSourceDirectories,
  toLazyServiceKey,
} from "./core/generation-inputs";
import type { AlloyScopesConfig } from "./core/scopes-validation";
import {
  normalizeImportPath,
  walkSync,
  writeFileIfChanged,
} from "./core/utils";
import {
  resolveVisualizationOptions,
  type AlloyVisualizationOptions,
  type ResolvedVisualizationOptions,
} from "./core/visualization-utils";

export type {
  AlloyMermaidVisualizerOptions,
  AlloyVisualizationOptions,
} from "./core/visualization-utils";

export interface AlloyPluginOptions {
  providers?: string[];
  /**
   * Source directories to scan for decorated services before the virtual
   * container is loaded. Relative paths are resolved against the project root.
   * Defaults to ["src"].
   */
  sourceDirs?: string[];
  /** Optional list of manifest objects to ingest */
  manifests?: AlloyManifest[];
  /** List of ServiceIdentifiers to mark as instantiation-lazy (adds factory Lazy wrapper) */
  lazyServices?: ServiceIdentifier[];
  /**
   * Output directory for the generated `virtual-container.d.ts` file.
   * Relative paths are resolved against the project root.
   * Defaults to "./src".
   */
  containerDeclarationDir?: string;
  /**
   * Emit dependency graph artifacts. When `true`, writes a Mermaid diagram to
   * `${projectRoot}/alloy-di.mmd`. Provide an object to customize output.
   */
  visualize?: boolean | AlloyVisualizationOptions;
  /**
   * Declares custom, application-defined scopes and their parent ordering, e.g.
   * `{ session: { parent: 'singleton' }, request: { parent: 'session' } }`.
   * Drives type-safe scope names (emitted into the generated declaration),
   * runtime hierarchy registration, and build-time scope-stability validation.
   */
  scopes?: AlloyScopesConfig;
}

export const ALLOY_PLUGIN_OPTIONS = Symbol.for("alloy-di.plugin-options");

interface ProviderModuleRef {
  absPath: string;
  importPath: string;
}

export interface ConsumerPluginConfigureOptions {
  root?: string;
  isDevMode?: boolean;
}

export interface ConsumerPluginContext {
  readonly options: AlloyPluginOptions;
  readonly virtualModuleId: "virtual:alloy-container";
  readonly resolvedVirtualModuleId: "\0virtual:alloy-container";
  readonly root: string;
  readonly sourceDirs: readonly string[];
  configure(options?: ConsumerPluginConfigureOptions): void;
  shouldTrackFactoryProviders(): boolean;
  processTransform(code: string, id: string): boolean;
  processFileUpdate(file: string, code: string): boolean;
  removeFile(file: string): boolean;
  buildStart(addWatchFile?: (file: string) => void): void;
  loadContainer(): Promise<{ code: string; moduleType: "js" }>;
  writeContainerCache(filePath: string): Promise<boolean>;
  getWatchFiles(): string[];
  getWatchDirectories(): string[];
}

export function createConsumerPluginContext(
  options: AlloyPluginOptions = {},
): ConsumerPluginContext {
  const configuredProviderEntries = Array.from(options.providers ?? []);
  const configuredSourceDirs = Array.from(
    options.sourceDirs ?? DEFAULT_SOURCE_DIRS,
  );
  const providerModuleRefs: ProviderModuleRef[] = [];
  const lazyServiceKeys = new Set(
    (options.lazyServices ?? []).map(toLazyServiceKey),
  );
  const discoveryRuntime = createDiscoveryRuntime();

  let resolvedRoot = process.cwd();
  let packageName = "UNKNOWN_PACKAGE";
  let resolvedVisualization: ResolvedVisualizationOptions | null = null;
  let isDevMode: boolean | undefined;

  function configure(config: ConsumerPluginConfigureOptions = {}): void {
    resolvedRoot = config.root ?? process.cwd();
    isDevMode = config.isDevMode;
    packageName = readPackageName(resolvedRoot);

    providerModuleRefs.length = 0;
    for (const entry of configuredProviderEntries) {
      const absPath = path.isAbsolute(entry)
        ? entry
        : path.resolve(resolvedRoot, entry);
      providerModuleRefs.push({
        absPath,
        importPath: normalizeImportPath(absPath),
      });
    }

    resolvedVisualization = resolveVisualizationOptions(
      options.visualize,
      resolvedRoot,
    );
  }

  async function loadContainer(): Promise<{ code: string; moduleType: "js" }> {
    return loadVirtualContainerModule({
      localMetas: Array.from(discoveryRuntime.discoveredClasses.values()),
      lazyReferencedClassKeys: discoveryRuntime.lazyReferencedClassKeys,
      manifests: options.manifests ?? [],
      providerImportPaths: providerModuleRefs.map((ref) => ref.importPath),
      factoryProviders: shouldTrackFactoryProviders()
        ? Array.from(discoveryRuntime.factoryProvidersByFile.values()).flat()
        : [],
      lazyServiceKeys,
      packageName,
      resolvedRoot,
      containerDeclarationDir: options.containerDeclarationDir,
      resolvedVisualization,
      isDevMode,
      scopes: options.scopes,
    });
  }

  function shouldTrackFactoryProviders(): boolean {
    return Boolean(resolvedVisualization);
  }

  return {
    options,
    virtualModuleId: "virtual:alloy-container",
    resolvedVirtualModuleId: "\0virtual:alloy-container",
    get root() {
      return resolvedRoot;
    },
    sourceDirs: configuredSourceDirs,
    configure,
    shouldTrackFactoryProviders,
    processTransform(code: string, id: string): boolean {
      return discoveryRuntime.processUpdate(id, code, {
        factoryProviders: shouldTrackFactoryProviders(),
      });
    },
    processFileUpdate(file: string, code: string): boolean {
      return discoveryRuntime.processUpdate(file, code, {
        factoryProviders: shouldTrackFactoryProviders(),
      });
    },
    removeFile(file: string): boolean {
      return discoveryRuntime.removeDiscoveredFile(file);
    },
    buildStart(addWatchFile?: (file: string) => void): void {
      discoveryRuntime.clear();
      for (const ref of providerModuleRefs) {
        addWatchFile?.(ref.absPath);
        if (shouldTrackFactoryProviders()) {
          try {
            const code = fs.readFileSync(ref.absPath, "utf-8");
            discoveryRuntime.processUpdate(ref.absPath, code, {
              factoryProviders: true,
            });
          } catch {
            // Ignore provider files the bundler will resolve later (e.g. package specifiers).
          }
        }
      }

      scanSourceDirectories(
        discoveryRuntime,
        resolvedRoot,
        configuredSourceDirs,
        { factoryProviders: shouldTrackFactoryProviders() },
      );
    },
    loadContainer,
    async writeContainerCache(filePath: string): Promise<boolean> {
      const result = await loadContainer();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      return writeFileIfChanged(filePath, result.code);
    },
    getWatchFiles(): string[] {
      return providerModuleRefs.map((ref) => ref.absPath);
    },
    getWatchDirectories(): string[] {
      return configuredSourceDirs.map((sourceDir) =>
        path.isAbsolute(sourceDir)
          ? sourceDir
          : path.resolve(resolvedRoot, sourceDir),
      );
    },
  };
}

export function isAlloyDiscoverableFile(file: string): boolean {
  return isDiscoverableFile(file);
}

export function discoverableFilesUnder(root: string): string[] {
  return walkSync(root).filter(isDiscoverableFile);
}

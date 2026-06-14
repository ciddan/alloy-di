import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";
import type { ServiceIdentifier } from "../../lib/service-identifiers";
import type { AlloyManifest } from "../core/types";
import { normalizeImportPath } from "../core/utils";
import { loadVirtualContainerModule } from "../core/container-loader";
import type { AlloyScopesConfig } from "../core/scopes-validation";
import {
  resolveVisualizationOptions,
  type AlloyVisualizationOptions,
  type ResolvedVisualizationOptions,
} from "../core/visualization-utils";

export type {
  AlloyMermaidVisualizerOptions,
  AlloyVisualizationOptions,
} from "../core/visualization-utils";
import {
  createDiscoveryRuntime,
  isDiscoverableFile,
} from "../core/discovery-runtime";
import {
  DEFAULT_SOURCE_DIRS,
  readPackageName,
  scanSourceDirectories,
  toLazyServiceKey,
} from "../core/generation-inputs";
import { invalidateContainerModule } from "./module-invalidation";

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

export const ALLOY_VITE_PLUGIN_OPTIONS = Symbol.for(
  "alloy-di.vite-plugin-options",
);

export interface AlloyVitePlugin extends Plugin {
  [ALLOY_VITE_PLUGIN_OPTIONS]: AlloyPluginOptions;
}

interface ProviderModuleRef {
  absPath: string;
  importPath: string;
}

/**
 * Creates the Alloy Vite plugin that statically discovers injectable classes
 * and exposes them through a virtual container module at build time.
 */
export function alloy(options: AlloyPluginOptions = {}): Plugin {
  const virtualModuleId = "virtual:alloy-container";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const configuredProviderEntries = Array.from(options.providers ?? []);
  const configuredSourceDirs = Array.from(
    options.sourceDirs ?? DEFAULT_SOURCE_DIRS,
  );
  const providerModuleRefs: ProviderModuleRef[] = [];

  let resolvedRoot = process.cwd();
  let packageName = "UNKNOWN_PACKAGE";
  let resolvedVisualization: ResolvedVisualizationOptions | null = null;
  let isDevMode: boolean | undefined;

  const lazyServiceKeys = new Set(
    (options.lazyServices ?? []).map(toLazyServiceKey),
  );

  const discoveryRuntime = createDiscoveryRuntime();

  const shouldTrackFactoryProviders = () => Boolean(resolvedVisualization);

  const plugin: AlloyVitePlugin = {
    name: "vite-plugin-alloy",
    enforce: "pre",
    [ALLOY_VITE_PLUGIN_OPTIONS]: options,

    configResolved(config) {
      resolvedRoot = config.root ?? process.cwd();
      isDevMode = !config.isProduction;
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
    },

    resolveId: {
      filter: { id: { include: [/^virtual:alloy-container$/] } },
      handler(id) {
        if (id === virtualModuleId) {
          return resolvedVirtualModuleId;
        }
        return undefined;
      },
    },

    // Discovery only — the code is never modified, so the handler returns
    // null and the filter keeps non-TS modules and node_modules (skipped for
    // performance & determinism; internal libraries should provide manifests
    // instead) from crossing the Rust/JS boundary under Rolldown.
    transform: {
      filter: {
        id: {
          include: [/\.tsx?$/i],
          exclude: [/\.d\.ts$/i, /node_modules/],
        },
      },
      handler(code, id) {
        discoveryRuntime.processUpdate(id, code, {
          factoryProviders: shouldTrackFactoryProviders(),
        });
        return null;
      },
    },

    async hotUpdate(ctx) {
      if (this.environment.name !== "client") {
        return;
      }

      const { file } = ctx;

      if (!isDiscoverableFile(file)) {
        return;
      }

      let discoveryChanged: boolean;
      if (ctx.type === "delete") {
        discoveryChanged = discoveryRuntime.removeDiscoveredFile(file);
      } else {
        let code: string;
        try {
          code = await ctx.read();
        } catch {
          return;
        }

        discoveryChanged = discoveryRuntime.processUpdate(file, code, {
          factoryProviders: shouldTrackFactoryProviders(),
        });
      }

      if (!discoveryChanged) {
        return;
      }

      // The discovered service graph changed. Regenerate the container by
      // invalidating it in every environment, then force a full reload so the
      // browser re-fetches the new wiring. The DI graph cannot be hot-swapped.
      invalidateContainerModule(ctx.server, resolvedVirtualModuleId);
      this.environment.hot.send({ type: "full-reload" });
      return [];
    },

    buildStart() {
      discoveryRuntime.clear();
      for (const ref of providerModuleRefs) {
        this.addWatchFile(ref.absPath);
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

      // Pre-scan configured source directories to ensure complete discovery before load()
      scanSourceDirectories(
        discoveryRuntime,
        resolvedRoot,
        configuredSourceDirs,
        { factoryProviders: shouldTrackFactoryProviders() },
      );
    },

    load: {
      // oxlint-disable-next-line no-control-regex -- \0 is Rollup's resolved virtual module prefix
      filter: { id: { include: [/^\0virtual:alloy-container$/] } },
      async handler(id) {
        if (id !== resolvedVirtualModuleId) {
          return undefined;
        }

        return loadVirtualContainerModule({
          localMetas: Array.from(discoveryRuntime.discoveredClasses.values()),
          lazyReferencedClassKeys: discoveryRuntime.lazyReferencedClassKeys,
          manifests: options.manifests ?? [],
          providerImportPaths: providerModuleRefs.map((ref) => ref.importPath),
          factoryProviders: shouldTrackFactoryProviders()
            ? Array.from(
                discoveryRuntime.factoryProvidersByFile.values(),
              ).flat()
            : [],
          lazyServiceKeys,
          packageName,
          resolvedRoot,
          containerDeclarationDir: options.containerDeclarationDir,
          resolvedVisualization,
          isDevMode,
          scopes: options.scopes,
        });
      },
    },
  };

  return plugin;
}

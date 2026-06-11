import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";
import type { ServiceIdentifier } from "../../lib/service-identifiers";
import {
  generateContainerModule,
  generateContainerTypeDefinition,
  generateManifestTypeDefinition,
} from "../core/codegen";
import type { AlloyManifest, DiscoveredMeta } from "../core/types";
import { normalizeImportPath, walkSync } from "../core/utils";
import { IdentifierResolver } from "../core/identifier-resolver";
import {
  readManifests,
  groupMetasByName,
  toMetaFromManifest,
  collectEagerReferencedNames,
  reconcileLazySet,
  augmentFactoryLazyServices,
  findDuplicateManifestServices,
} from "./manifest-utils";
import { generateMermaidDiagram } from "./visualizer";
import {
  ensureDirectoryForFile,
  resolveVisualizationOptions,
  type AlloyVisualizationOptions,
  type ResolvedVisualizationOptions,
} from "./visualization-utils";

export type {
  AlloyMermaidVisualizerOptions,
  AlloyVisualizationOptions,
} from "./visualization-utils";
import {
  createDiscoveryRuntime,
  invalidateContainerModule,
  isDiscoverableFile,
} from "./discovery-runtime";

export interface AlloyPluginOptions {
  providers?: string[];
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
}

interface ProviderModuleRef {
  absPath: string;
  importPath: string;
}

function toLazyServiceKey(identifier: ServiceIdentifier): string {
  const description = identifier.description;
  if (!description || !description.startsWith("alloy:")) {
    throw new Error(
      "[alloy] lazyServices entries must be serviceIdentifiers exported by Alloy manifests.",
    );
  }
  return description;
}

/**
 * Creates the Alloy Vite plugin that statically discovers injectable classes
 * and exposes them through a virtual container module at build time.
 */
export function alloy(options: AlloyPluginOptions = {}): Plugin {
  const virtualModuleId = "virtual:alloy-container";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;
  const configuredProviderEntries = Array.from(options.providers ?? []);
  const providerModuleRefs: ProviderModuleRef[] = [];
  let resolvedRoot = process.cwd();
  let packageName = "UNKNOWN_PACKAGE";
  let resolvedVisualization: ResolvedVisualizationOptions | null = null;
  const lazyServiceKeys = new Set(
    (options.lazyServices ?? []).map(toLazyServiceKey),
  );
  const discoveryRuntime = createDiscoveryRuntime();

  return {
    name: "vite-plugin-alloy",
    enforce: "pre",

    configResolved(config) {
      resolvedRoot = config.root ?? process.cwd();
      try {
        const pkgPath = path.resolve(resolvedRoot, "package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (typeof pkg.name === "string") {
          packageName = pkg.name;
        }
      } catch {
        // ignore
      }

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
        discoveryRuntime.processUpdate(id, code);
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

        discoveryChanged = discoveryRuntime.processUpdate(file, code);
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
      }

      // Pre-scan project files in src/ to ensure complete discovery before load()
      const srcDir = path.join(resolvedRoot, "src");
      const files = walkSync(srcDir);
      for (const file of files) {
        if (/\.(tsx?|ts)$/i.test(file) && !file.endsWith(".d.ts")) {
          try {
            const code = fs.readFileSync(file, "utf-8");
            discoveryRuntime.processUpdate(file, code);
          } catch {
            // Ignore read errors
          }
        }
      }
    },

    load: {
      // oxlint-disable-next-line no-control-regex -- \0 is Rollup's resolved virtual module prefix
      filter: { id: { include: [/^\0virtual:alloy-container$/] } },
      async handler(id) {
        if (id !== resolvedVirtualModuleId) {
          return undefined;
        }
        const metas = Array.from(discoveryRuntime.discoveredClasses.values());

        // Attach identifier keys to local metas for deterministic output
        for (const meta of metas) {
          const normalizedMetaPath = normalizeImportPath(meta.filePath);
          const trimmedNormalizedMetaPath = normalizedMetaPath.replaceAll(
            /^\/+/g,
            "",
          );
          const looksRootRelative =
            normalizedMetaPath === "/src" ||
            normalizedMetaPath.startsWith("/src/");

          let relPath = path.relative(resolvedRoot, meta.filePath);
          if (path.sep === "\\") {
            relPath = relPath.split(path.sep).join("/");
          }

          if (
            looksRootRelative ||
            !relPath ||
            relPath.startsWith("..") ||
            relPath.startsWith("\\")
          ) {
            relPath =
              trimmedNormalizedMetaPath ||
              normalizedMetaPath.replaceAll(/^\/+/g, "");
          }

          meta.identifierKey = `alloy:${packageName}/${relPath}#${meta.className}`;
        }

        const manifestData = await readManifests(options.manifests ?? []);
        const manifestServices = manifestData.services;
        const loadedManifests = manifestData.loadedManifests;

        if (metas.length && manifestServices.length) {
          const duplicates = findDuplicateManifestServices(
            metas,
            manifestServices,
          );
          if (duplicates.length) {
            const details = duplicates
              .map(
                (d) =>
                  `- ${d.exportName}: local [${d.localPaths.join(", ")}] vs manifest '${d.manifestImport}'`,
              )
              .join("\n");
            throw new Error(
              [
                "[alloy] Duplicate service registrations detected.",
                details,
                "Resolve by removing one source (local or manifest) to avoid ambiguous DI keys.",
              ].join("\n"),
            );
          }
        }

        const combinedMetas: DiscoveredMeta[] = [
          ...metas,
          ...manifestServices.map((svc) => ({
            className: svc.exportName,
            filePath: svc.importPath,
            metadata: { scope: svc.scope, dependencies: [] },
          })),
        ];
        const resolver = new IdentifierResolver(combinedMetas);
        const metasByName = groupMetasByName(combinedMetas);

        for (const svc of manifestServices) {
          metas.push(
            toMetaFromManifest(
              svc,
              metasByName,
              resolver,
              discoveryRuntime.lazyReferencedClassKeys,
            ),
          );
        }

        const providerImports = Array.from(
          new Set([
            ...providerModuleRefs.map((ref) => ref.importPath),
            ...manifestData.providers,
          ]),
        );

        const eagerReferencedNames = collectEagerReferencedNames(metas);
        reconcileLazySet(
          metas,
          discoveryRuntime.lazyReferencedClassKeys,
          eagerReferencedNames,
        );
        augmentFactoryLazyServices(metas, lazyServiceKeys);

        // Rewrite relative imports is now handled by codegen.ts during reconstruction

        const code = generateContainerModule(
          metas,
          new Set(discoveryRuntime.lazyReferencedClassKeys),
          providerImports,
        );

        const dtsDir = path.resolve(
          resolvedRoot,
          options.containerDeclarationDir ?? "./src",
        );

        const dtsContent = generateContainerTypeDefinition(
          metas,
          (filePath) => {
            if (path.isAbsolute(filePath)) {
              let rel = path.relative(dtsDir, filePath);
              rel = rel.split(path.sep).join(path.posix.sep);
              if (!rel.startsWith(".")) {
                rel = "./" + rel;
              }
              return rel;
            }
            return filePath;
          },
        );

        if (!fs.existsSync(dtsDir)) {
          fs.mkdirSync(dtsDir, { recursive: true });
        }

        const dtsPath = path.join(dtsDir, "alloy-container.d.ts");
        fs.writeFileSync(dtsPath, dtsContent);

        // Generate ambient declarations for consumed manifests
        if (loadedManifests && loadedManifests.length > 0) {
          const manifestsDts = generateManifestTypeDefinition(
            loadedManifests.map((m) => ({
              packageName: m.packageName,
              services: m.services,
            })),
          );
          const manifestsDtsPath = path.join(dtsDir, "alloy-manifests.d.ts");
          fs.writeFileSync(manifestsDtsPath, manifestsDts);
        }

        if (resolvedVisualization) {
          const artifact = generateMermaidDiagram({
            metas,
            lazyClassKeys: new Set(discoveryRuntime.lazyReferencedClassKeys),
            options: resolvedVisualization.mermaidOptions,
          });
          ensureDirectoryForFile(resolvedVisualization.outputPath);
          fs.writeFileSync(
            resolvedVisualization.outputPath,
            `${artifact.diagram}\n`,
          );
        }

        // The virtual module id has no file extension, so Rolldown (Vite 8+)
        // cannot infer its module type and needs an explicit one.
        return { code, moduleType: "js" };
      },
    },
  };
}

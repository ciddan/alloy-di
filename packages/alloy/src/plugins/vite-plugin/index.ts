import path from "node:path";
import fs from "node:fs";
import { Plugin } from "vite";
import type { ServiceIdentifier } from "../../lib/service-identifiers";
import {
  generateContainerModule,
  generateContainerTypeDefinition,
  generateManifestTypeDefinition,
} from "../core/codegen";
import type {
  AlloyManifest,
  DiscoveredMeta,
  ManifestServiceDescriptor,
} from "../core/types";
import { createClassKey, normalizeImportPath, walkSync } from "../core/utils";
import { createDiscoveryStore } from "../core/discovery-store";
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
  const lazyServiceKeys = new Set(
    (options.lazyServices ?? []).map(toLazyServiceKey),
  );

  const discovery = createDiscoveryStore();
  // Discovery registries
  const discoveredClasses = new Map<string, DiscoveredMeta>();
  const lazyReferencedClassKeys = new Set<string>();

  const processUpdate = (id: string, code: string) => {
    const { metas, lazyClassKeys, previousMetas, previousLazyClassKeys } =
      discovery.updateFile(id, code);

    if (previousMetas) {
      for (const meta of previousMetas) {
        discoveredClasses.delete(createClassKey(meta.filePath, meta.className));
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
  };

  return {
    name: "vite-plugin-alloy",

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
    },

    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      return undefined;
    },

    transform(code, id) {
      const isTS = /\.(tsx?|ts)$/i.test(id);
      if (!isTS || id.endsWith(".d.ts")) {
        return null;
      }
      const isNodeModule = id.includes("node_modules");
      // Always skip node_modules for performance & determinism; internal libraries should provide manifests instead.
      if (isNodeModule) {
        return null;
      }

      processUpdate(id, code);
      return { code, map: null };
    },

    handleHotUpdate(ctx) {
      const file = ctx.file;
      if (!ctx.modules.length) {
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
      }
      return ctx.modules;
    },

    buildStart() {
      discovery.clear();
      discoveredClasses.clear();
      lazyReferencedClassKeys.clear();
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
            processUpdate(file, code);
          } catch {
            // Ignore read errors
          }
        }
      }
    },

    async load(id) {
      if (id !== resolvedVirtualModuleId) {
        return undefined;
      }
      const metas = Array.from(discoveredClasses.values());

      // Attach identifier keys to local metas for deterministic output
      for (const meta of metas) {
        let relPath = path.relative(resolvedRoot, meta.filePath);
        if (path.sep === "\\") {
          relPath = relPath.split(path.sep).join("/");
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
        ...manifestServices.map((svc: ManifestServiceDescriptor) => ({
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
            lazyReferencedClassKeys,
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
      reconcileLazySet(metas, lazyReferencedClassKeys, eagerReferencedNames);
      augmentFactoryLazyServices(metas, lazyServiceKeys);

      // Rewrite relative imports is now handled by codegen.ts during reconstruction

      const code = generateContainerModule(
        metas,
        new Set(lazyReferencedClassKeys),
        providerImports,
      );

      const dtsDir = path.resolve(
        resolvedRoot,
        options.containerDeclarationDir ?? "./src",
      );

      const dtsContent = generateContainerTypeDefinition(metas, (filePath) => {
        if (path.isAbsolute(filePath)) {
          let rel = path.relative(dtsDir, filePath);
          rel = rel.split(path.sep).join(path.posix.sep);
          if (!rel.startsWith(".")) {
            rel = "./" + rel;
          }
          return rel;
        }
        return filePath;
      });

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

      return code;
    },
  };
}

import fs from "node:fs";
import path from "node:path";
import {
  determineBuildMode,
  hasPreserveModules,
  resolveImportPathForBuild,
  type BuildMode,
} from "./build-utils";
import { createDiscoveryStore } from "../core/discovery-store";
import { ServiceScope } from "../../lib/scope";
import {
  validateScopeStability,
  validateScopesConfig,
} from "../core/scopes-validation";
import type {
  ManifestServiceDescriptor,
  ManifestServiceDescriptorV2,
} from "../core/types";
import type {
  AlloyManifestV2,
  AlloyManifestPluginOptions,
  MinimalRollupPlugin,
} from "./types";
import { parseExportedNames } from "./barrel-exports";
import { createManifestDependency } from "./manifest-deps";
import { checkPackageExports } from "./package-exports";

export type { AlloyManifestPluginOptions };

/**
 * Rollup/Rolldown plugin that scans decorated Alloy services and emits an ESM manifest.
 */
export function alloy(
  options: AlloyManifestPluginOptions = {},
): MinimalRollupPlugin {
  const fileName = options.fileName ?? "alloy.manifest.mjs";
  const packageJsonFile = options.packageJsonPath
    ? path.isAbsolute(options.packageJsonPath)
      ? options.packageJsonPath
      : path.resolve(process.cwd(), options.packageJsonPath)
    : path.resolve(process.cwd(), "package.json");

  let packageName = "UNKNOWN_PACKAGE";
  try {
    const pkgRaw = fs.readFileSync(packageJsonFile, "utf8");
    const pkg = JSON.parse(pkgRaw);
    if (typeof pkg.name === "string") {
      packageName = pkg.name;
    }
  } catch {
    // swallow; will emit UNKNOWN_PACKAGE which surfaces during consumption tests.
  }

  const packageRoot = path.dirname(packageJsonFile);

  const discovery = createDiscoveryStore({ trackSources: true });

  /**
   * Determines the build mode based on output options and discovered services.
   *
   * Build modes affect import path resolution:
   * - `preserve-modules`: Each source file becomes a separate output module with subpath imports
   * - `chunks`: Multiple services with chunked output (multi-entry)
   * - `bundled`: All services bundled into a single entry point
   *
   * @param outputOptions - Rollup/Rolldown output configuration
   * @returns Build mode identifier
   */
  function getBuildMode(outputOptions: unknown): BuildMode {
    const preserve = hasPreserveModules(outputOptions)
      ? Boolean(outputOptions.preserveModules)
      : false;
    const discoveredServiceCount = [...discovery.fileMetas.values()].reduce(
      (acc, metas) => acc + metas.length,
      0,
    );
    return determineBuildMode(preserve, discoveredServiceCount);
  }

  return {
    name: "alloy-manifest",

    transform(code: string, id: string) {
      const isTS = /\.(tsx?|mts|cts)$/i.test(id);
      const isDeclaration = id.endsWith(".d.ts");
      if (!isTS || isDeclaration) {
        return null;
      }
      discovery.updateFile(id, code);
      return null; // we don't modify code
    },

    generateBundle(outputOptions: unknown) {
      const buildMode = getBuildMode(outputOptions);

      // Scope-stability validation is opt-in: it runs only when custom scopes
      // are declared, leaving non-scoped library builds unchanged.
      if (options.scopes && Object.keys(options.scopes).length > 0) {
        validateScopesConfig(options.scopes);
        const allMetas = [...discovery.fileMetas.values()].flat();
        validateScopeStability(allMetas, options.scopes);
      }

      const services: ManifestServiceDescriptorV2[] = [];
      const missingExports: string[] = [];

      // Export parsing (bundled/chunks modes): gather exported names from barrel if present.
      const exportedNames =
        buildMode === "preserve-modules"
          ? new Set<string>()
          : parseExportedNames(discovery.fileSources);

      for (const metas of discovery.fileMetas.values()) {
        for (const meta of metas) {
          const scope = meta.metadata.scope ?? ServiceScope.TRANSIENT;

          const importPath = resolveImportPathForBuild(
            meta.filePath,
            packageName,
            buildMode,
          );

          // Generate stable symbol key: alloy:<pkg>/<rel-path>#<Class>
          let relPath = path.relative(packageRoot, meta.filePath);
          if (path.sep === "\\") {
            relPath = relPath.split(path.sep).join("/");
          }
          const symbolKey = `alloy:${packageName}/${relPath}#${meta.className}`;

          services.push({
            exportName: meta.className,
            importPath,
            symbolKey,
            scope,
            deps: [],
          });
          if (
            buildMode !== "preserve-modules" &&
            !exportedNames.has(meta.className)
          ) {
            missingExports.push(meta.className);
          }
        }
      }

      const serviceByName = new Map<string, ManifestServiceDescriptorV2>();
      const knownServiceNames = new Set<string>();
      for (const service of services) {
        serviceByName.set(service.exportName, service);
        knownServiceNames.add(service.exportName);
      }

      for (const metas of discovery.fileMetas.values()) {
        for (const meta of metas) {
          const svc = serviceByName.get(meta.className);
          if (!svc) {
            continue;
          }

          for (const dep of meta.metadata.dependencies) {
            const manifestDep = createManifestDependency(
              dep,
              meta,
              knownServiceNames,
              packageName,
              buildMode,
            );
            if (manifestDep) {
              svc.deps.push(manifestDep);
            }
          }
        }
      }

      const manifest: AlloyManifestV2 = {
        schemaVersion: 2,
        packageName,
        buildMode,
        services,
        diagnostics: {
          barrelFallback: buildMode !== "preserve-modules",
          missingExports: missingExports.length ? missingExports : undefined,
        },
      };

      // Duplicate detection
      const nameOccurrences = new Map<string, ManifestServiceDescriptor[]>();
      for (const svc of services) {
        const arr = nameOccurrences.get(svc.exportName);
        if (arr) {
          arr.push(svc);
        } else {
          nameOccurrences.set(svc.exportName, [svc]);
        }
      }
      for (const arr of nameOccurrences.values()) {
        if (arr.length > 1) {
          if (!manifest.diagnostics) {
            manifest.diagnostics = {};
          }
          const dup = manifest.diagnostics.duplicateServices ?? [];
          for (const svc of arr) {
            dup.push(`${svc.exportName}|${svc.importPath}`);
          }
          manifest.diagnostics.duplicateServices = dup;
        }
      }

      // Provider support: require preserve-modules for predictable public subpaths.
      const providerPaths = Array.isArray(options.providers)
        ? options.providers
        : [];
      if (providerPaths.length) {
        if (buildMode !== "preserve-modules") {
          throw new Error(
            "Alloy manifest plugin: 'providers' requires preserveModules=true to emit stable public import specifiers. Enable preserveModules in your library build, or expose provider modules via root exports and omit 'providers' here.",
          );
        }
        const resolvedProviders: string[] = [];
        for (const p of providerPaths) {
          const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
          const spec = resolveImportPathForBuild(
            abs,
            packageName,
            "preserve-modules",
          );
          resolvedProviders.push(spec);
        }
        manifest.providers = resolvedProviders;
      }

      const code = `// Generated Alloy manifest (v2)\nexport const manifest = ${JSON.stringify(manifest, null, 2)};\n`;

      // Generate optional service-identifiers helper
      const identifiersCode = [
        "// Generated Alloy Service Identifiers",
        ...services.map(
          (s) =>
            `export const ${s.exportName}Identifier = Symbol.for("${s.symbolKey}");`,
        ),
      ].join("\n");

      if (this.emitFile) {
        this.emitFile({
          type: "asset",
          fileName,
          source: code,
        });
        this.emitFile({
          type: "asset",
          fileName: "service-identifiers.mjs",
          source: identifiersCode,
        });
      } else {
        // Fallback: write directly (non-standard environments)
        try {
          fs.writeFileSync(path.resolve(process.cwd(), fileName), code, "utf8");
          fs.writeFileSync(
            path.resolve(process.cwd(), "service-identifiers.mjs"),
            identifiersCode,
            "utf8",
          );
        } catch {
          // ignore write failure in fallback
        }
      }

      checkPackageExports(packageJsonFile, fileName);
    },
  };
}

export default alloy;

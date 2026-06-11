import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  determineBuildMode,
  hasPreserveModules,
  resolveImportPathForBuild,
} from "./build-utils";
import {
  parseLazyDependencyExpression,
  resolveModuleSpecifierCandidates,
} from "../core/lazy";
import type {
  DependencyDescriptor,
  DiscoveredMeta,
  ManifestDependencyEntry,
  ManifestServiceDescriptor,
  ManifestServiceDescriptorV2,
} from "../core/types";
import { createDiscoveryStore } from "../core/discovery-store";
import { ServiceScope } from "../../lib/scope";

/** Check if a node has the 'export' modifier */
function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

interface AlloyManifestV2 {
  schemaVersion: 2;
  packageName: string;
  buildMode: "preserve-modules" | "bundled" | "chunks";
  services: ManifestServiceDescriptorV2[];
  /** Optional provider module import specifiers (internal library-provided). */
  providers?: string[];
  diagnostics?: {
    barrelFallback?: boolean;
    duplicateServices?: string[];
    missingExports?: string[];
  };
}

export interface AlloyManifestPluginOptions {
  /** Optional override for emitted filename. Defaults to 'alloy.manifest.mjs'. */
  fileName?: string;
  /** Relative or absolute path to package.json if not at cwd root. */
  packageJsonPath?: string;
  /**
   * Optional list of provider module source paths to include in the manifest.
   * These should be file paths within the library (e.g., 'src/providers.ts').
   * In `preserveModules` builds, import specifiers will be derived and emitted
   * so consumer apps can import and apply them automatically.
   */
  providers?: string[];
}

/**
 * Rollup/Rolldown plugin that scans decorated Alloy services and emits an ESM manifest.
 */
interface MinimalRollupPlugin {
  name: string;
  transform?(code: string, id: string): unknown;
  generateBundle?(outputOptions: unknown): void;
  emitFile?(file: { type: "asset"; fileName: string; source: string }): void;
}

function getDependencyImports(
  meta: DiscoveredMeta,
  dep: DependencyDescriptor,
): NonNullable<DiscoveredMeta["referencedImports"]> {
  const imports = meta.referencedImports ?? [];
  if (imports.length === 0 || dep.referencedIdentifiers.length === 0) {
    return [];
  }
  const identifiers = new Set(dep.referencedIdentifiers);
  return imports.filter((entry) => identifiers.has(entry.name));
}

function getDependencyReferenceName(expression: string): string | undefined {
  const sourceFile = ts.createSourceFile(
    "dependency.ts",
    `const __dep = (${expression});`,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) {
    return undefined;
  }
  const initializer = statement.declarationList.declarations[0]?.initializer;
  if (!initializer) {
    return undefined;
  }
  return extractReferenceNameFromExpression(initializer);
}

function extractReferenceNameFromExpression(
  expression: ts.Expression,
): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (
    ts.isAsExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return extractReferenceNameFromExpression(expression.expression);
  }
  return undefined;
}

function resolveClassDependencyName(
  dep: DependencyDescriptor,
  meta: DiscoveredMeta,
  knownServiceNames: Set<string>,
): string | undefined {
  const imports = getDependencyImports(meta, dep);
  for (const entry of imports) {
    if (entry.originalName && knownServiceNames.has(entry.originalName)) {
      return entry.originalName;
    }
  }

  const referenceName = getDependencyReferenceName(dep.expression);
  if (referenceName && knownServiceNames.has(referenceName)) {
    return referenceName;
  }

  return dep.referencedIdentifiers.find((name) => knownServiceNames.has(name));
}

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
  function getBuildMode(outputOptions: unknown): AlloyManifestV2["buildMode"] {
    const preserve = hasPreserveModules(outputOptions)
      ? Boolean(outputOptions.preserveModules)
      : false;
    const discoveredServiceCount = [...discovery.fileMetas.values()].reduce(
      (acc, metas) => acc + metas.length,
      0,
    );
    return determineBuildMode(preserve, discoveredServiceCount);
  }

  /**
   * Parses the barrel export file (index.ts) to extract all publicly exported symbol names.
   * Used in bundled/chunks modes to detect services that aren't properly exported.
   *
   * Looks for:
   * - `export class Foo`
   * - `export const bar`
   * - `export function baz`
   * - `export { Foo, Bar }`
   *
   * @returns Set of exported symbol names found in the barrel file
   */
  function parseExportedNames(): Set<string> {
    let exportedNames = new Set<string>();
    const sources = discovery.fileSources;
    if (!sources) {
      return exportedNames;
    }
    // Find barrel entry point - prefer /src/index.ts, fallback to /index.ts
    const barrelEntry =
      [...sources.keys()].find((p) =>
        /\/src\/index\.(tsx?|mts|cts)$/i.test(p),
      ) ?? [...sources.keys()].find((p) => /\/index\.(tsx?|ts)$/i.test(p));
    const sourceText = barrelEntry ? sources.get(barrelEntry) : undefined;
    if (!barrelEntry || !sourceText) {
      return exportedNames;
    }

    // Parse barrel file as TypeScript AST
    const sf = ts.createSourceFile(
      barrelEntry,
      sourceText,
      ts.ScriptTarget.ESNext,
      true,
    );
    const names = new Set<string>();

    // Visit AST nodes to collect exported identifiers
    const visit = (node: ts.Node) => {
      // export class Foo
      if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) {
        names.add(node.name.text);
      }

      // export const bar = ...
      if (ts.isVariableStatement(node) && hasExportModifier(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            names.add(decl.name.text);
          }
        }
      }

      // export function baz()
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        hasExportModifier(node)
      ) {
        names.add(node.name.text);
      }

      // export { Foo, Bar }
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const el of node.exportClause.elements) {
          names.add(el.name.text);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sf, visit);
    exportedNames = names;
    return exportedNames;
  }

  /**
   * Resolves the public import path for a service based on build mode and source location.
   *
   * Resolution strategies:
   * - `preserve-modules`: Derives subpath from /src/ directory structure
   * - `chunks`: Uses base filename as subpath
   * - `bundled`: Uses package root
   *
   * @param targetPath - Absolute path to source file
   * @param buildMode - Current build mode
   * @returns Public import specifier (e.g., "@myorg/pkg/subpath")
   */
  function resolveImportPath(
    targetPath: string,
    buildMode: AlloyManifestV2["buildMode"],
  ): string {
    return resolveImportPathForBuild(targetPath, packageName, buildMode);
  }

  function resolveDependencyImportPath(
    specifier: string,
    sourceFilePath: string,
    buildMode: AlloyManifestV2["buildMode"],
  ): string {
    if (specifier.startsWith(".")) {
      const resolvedCandidates = resolveModuleSpecifierCandidates(
        sourceFilePath,
        specifier,
      );
      const targetPath =
        resolvedCandidates[0] ??
        path.resolve(path.dirname(sourceFilePath), specifier);
      return resolveImportPath(targetPath, buildMode);
    }
    if (path.isAbsolute(specifier)) {
      return resolveImportPath(specifier, buildMode);
    }
    return specifier;
  }

  function createTokenDependency(
    dep: DependencyDescriptor,
    meta: DiscoveredMeta,
    buildMode: AlloyManifestV2["buildMode"],
  ): Extract<ManifestDependencyEntry, { kind: "token" }> {
    const imports = getDependencyImports(meta, dep);
    const preferredImport = imports.find((entry) => entry.originalName !== "*");
    const exportName =
      preferredImport?.originalName ??
      getDependencyReferenceName(dep.expression) ??
      dep.referencedIdentifiers[0] ??
      dep.expression;
    const importPath = preferredImport
      ? resolveDependencyImportPath(
          preferredImport.path,
          meta.filePath,
          buildMode,
        )
      : packageName;

    return {
      kind: "token",
      exportName,
      importPath,
    };
  }

  function createManifestDependency(
    dep: DependencyDescriptor,
    meta: DiscoveredMeta,
    knownServiceNames: Set<string>,
    buildMode: AlloyManifestV2["buildMode"],
  ): ManifestDependencyEntry | null {
    if (dep.isLazy) {
      const parsedLazy = parseLazyDependencyExpression(
        dep.expression,
        meta.filePath,
      );
      if (!parsedLazy) {
        return null;
      }
      const entry: Extract<ManifestDependencyEntry, { kind: "lazy" }> = {
        kind: "lazy",
        exportName: parsedLazy.exportName,
        importPath: resolveDependencyImportPath(
          parsedLazy.specifier,
          meta.filePath,
          buildMode,
        ),
      };
      if (parsedLazy.retry) {
        entry.retry = parsedLazy.retry;
      }
      return entry;
    }

    const className = resolveClassDependencyName(dep, meta, knownServiceNames);
    if (className) {
      return { kind: "class", exportName: className };
    }

    return createTokenDependency(dep, meta, buildMode);
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

      const services: ManifestServiceDescriptorV2[] = [];
      const missingExports: string[] = [];

      // Export parsing (bundled/chunks modes): gather exported names from barrel if present.
      const exportedNames =
        buildMode === "preserve-modules"
          ? new Set<string>()
          : parseExportedNames();

      for (const metas of discovery.fileMetas.values()) {
        for (const meta of metas) {
          const scope = meta.metadata.scope ?? ServiceScope.TRANSIENT;

          const importPath = resolveImportPath(meta.filePath, buildMode);

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
          const spec = resolveImportPath(abs, "preserve-modules");
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

function checkPackageExports(
  packageJsonPath: string,
  manifestFileName: string,
) {
  try {
    const pkgRaw = fs.readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(pkgRaw);
    if (!pkg.exports) {
      return;
    }

    const exports = pkg.exports;
    const hasManifest = Object.values(exports).some(
      (e: unknown) =>
        (typeof e === "string" && e.includes(manifestFileName)) ||
        (typeof e === "object" &&
          e !== null &&
          Object.values(e).some((v: unknown) =>
            String(v).includes(manifestFileName),
          )),
    );

    const hasIdentifiers = Object.values(exports).some(
      (e: unknown) =>
        (typeof e === "string" && e.includes("service-identifiers.mjs")) ||
        (typeof e === "object" &&
          e !== null &&
          Object.values(e).some((v: unknown) =>
            String(v).includes("service-identifiers.mjs"),
          )),
    );

    if (!hasManifest) {
      console.warn(
        `[alloy] Warning: ${manifestFileName} is not exposed in package.json "exports". Consumers may not be able to access the manifest.`,
      );
    }
    if (!hasIdentifiers) {
      console.warn(
        `[alloy] Warning: service-identifiers.mjs is not exposed in package.json "exports". Consumers may not be able to access the generated identifiers helper.`,
      );
    }
  } catch {
    // ignore
  }
}

export default alloy;

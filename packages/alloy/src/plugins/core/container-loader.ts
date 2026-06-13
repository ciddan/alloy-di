import fs from "node:fs";
import path from "node:path";
import {
  GENERATED_FILE_NOTICE,
  generateContainerModule,
  generateContainerTypeDefinition,
  generateManifestTypeDefinition,
} from "./codegen";
import type { AlloyManifest, DiscoveredMeta } from "./types";
import { normalizeImportPath, writeFileIfChanged } from "./utils";
import { IdentifierResolver } from "./identifier-resolver";
import {
  augmentFactoryLazyServices,
  collectEagerReferencedNames,
  findDuplicateManifestServices,
  groupMetasByName,
  readManifests,
  reconcileLazySet,
  toMetaFromManifest,
} from "./manifest-utils";
import { generateMermaidDiagram } from "./visualizer";
import {
  validateScopeStability,
  validateScopesConfig,
  type AlloyScopesConfig,
} from "./scopes-validation";
import {
  ensureDirectoryForFile,
  type ResolvedVisualizationOptions,
} from "./visualization-utils";

export interface LoadVirtualContainerOptions {
  localMetas: DiscoveredMeta[];
  lazyReferencedClassKeys: Set<string>;
  manifests: AlloyManifest[];
  providerImportPaths: string[];
  lazyServiceKeys: Set<string>;
  packageName: string;
  resolvedRoot: string;
  containerDeclarationDir?: string;
  resolvedVisualization: ResolvedVisualizationOptions | null;
  /** Bundler-resolved mode, injected into the generated module when known. */
  isDevMode?: boolean;
  /** Declared custom scope hierarchy (names + parent ordering). */
  scopes?: AlloyScopesConfig;
}

export async function loadVirtualContainerModule(
  options: LoadVirtualContainerOptions,
): Promise<{ code: string; moduleType: "js" }> {
  const metas = options.localMetas.map((meta) => ({
    ...meta,
    metadata: { ...meta.metadata },
  }));
  const lazyClassKeys = new Set(options.lazyReferencedClassKeys);

  assignIdentifierKeys(metas, options.packageName, options.resolvedRoot);

  const manifestData = await readManifests(options.manifests);
  const manifestServices = manifestData.services;
  const loadedManifests = manifestData.loadedManifests;

  assertNoDuplicateManifestServices(metas, manifestServices);

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
    metas.push(toMetaFromManifest(svc, metasByName, resolver, lazyClassKeys));
  }

  const providerImports = Array.from(
    new Set([...options.providerImportPaths, ...manifestData.providers]),
  );

  const eagerReferencedNames = collectEagerReferencedNames(metas);
  reconcileLazySet(metas, lazyClassKeys, eagerReferencedNames);
  augmentFactoryLazyServices(metas, options.lazyServiceKeys);

  // Scope-stability validation is opt-in: it runs only when custom scopes are
  // declared. Projects without a `scopes` config keep today's behavior exactly
  // (e.g. a singleton may freely depend on a transient).
  if (options.scopes && Object.keys(options.scopes).length > 0) {
    validateScopesConfig(options.scopes);
    validateScopeStability(metas, options.scopes);
  }

  const code = generateContainerModule(metas, lazyClassKeys, providerImports, {
    isDev: options.isDevMode,
    scopes: options.scopes,
  });

  writeTypeDefinitions(
    metas,
    loadedManifests,
    options.resolvedRoot,
    options.containerDeclarationDir,
    options.scopes,
  );

  writeVisualizationArtifact(
    metas,
    lazyClassKeys,
    options.resolvedVisualization,
  );

  return { code, moduleType: "js" };
}

function assignIdentifierKeys(
  metas: DiscoveredMeta[],
  packageName: string,
  resolvedRoot: string,
): void {
  for (const meta of metas) {
    const normalizedMetaPath = normalizeImportPath(meta.filePath);
    const trimmedNormalizedMetaPath = normalizedMetaPath.replaceAll(
      /^\/+/g,
      "",
    );
    const looksRootRelative =
      normalizedMetaPath === "/src" || normalizedMetaPath.startsWith("/src/");

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
        trimmedNormalizedMetaPath || normalizedMetaPath.replaceAll(/^\/+/g, "");
    }

    meta.identifierKey = `alloy:${packageName}/${relPath}#${meta.className}`;
  }
}

function assertNoDuplicateManifestServices(
  metas: DiscoveredMeta[],
  manifestServices: Awaited<ReturnType<typeof readManifests>>["services"],
): void {
  if (!metas.length || !manifestServices.length) {
    return;
  }

  const duplicates = findDuplicateManifestServices(metas, manifestServices);
  if (!duplicates.length) {
    return;
  }

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

function writeTypeDefinitions(
  metas: DiscoveredMeta[],
  loadedManifests: Awaited<ReturnType<typeof readManifests>>["loadedManifests"],
  resolvedRoot: string,
  containerDeclarationDir: string | undefined,
  scopes: AlloyScopesConfig | undefined,
): void {
  const dtsDir = path.resolve(resolvedRoot, containerDeclarationDir ?? "./src");
  const dtsContent = generateContainerTypeDefinition(
    metas,
    (filePath) => resolveDeclarationImportPath(dtsDir, filePath),
    scopes ? Object.keys(scopes) : [],
  );

  if (!fs.existsSync(dtsDir)) {
    fs.mkdirSync(dtsDir, { recursive: true });
  }

  writeFileIfChanged(path.join(dtsDir, "alloy-container.d.ts"), dtsContent);

  if (loadedManifests.length === 0) {
    return;
  }

  const manifestsDts = generateManifestTypeDefinition(
    loadedManifests.map((m) => ({
      packageName: m.packageName,
      services: m.services,
    })),
  );

  writeFileIfChanged(path.join(dtsDir, "alloy-manifests.d.ts"), manifestsDts);
}

function resolveDeclarationImportPath(
  dtsDir: string,
  filePath: string,
): string {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  let rel = path.relative(dtsDir, filePath);
  rel = rel.split(path.sep).join(path.posix.sep);
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  return rel;
}

function writeVisualizationArtifact(
  metas: DiscoveredMeta[],
  lazyReferencedClassKeys: Set<string>,
  resolvedVisualization: ResolvedVisualizationOptions | null,
): void {
  if (!resolvedVisualization) {
    return;
  }

  const artifact = generateMermaidDiagram({
    metas,
    lazyClassKeys: new Set(lazyReferencedClassKeys),
    options: resolvedVisualization.mermaidOptions,
  });
  ensureDirectoryForFile(resolvedVisualization.outputPath);
  writeFileIfChanged(
    resolvedVisualization.outputPath,
    `%% ${GENERATED_FILE_NOTICE}\n${artifact.diagram}\n`,
  );
}

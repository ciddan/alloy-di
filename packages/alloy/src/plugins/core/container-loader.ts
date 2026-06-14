import fs from "node:fs";
import path from "node:path";
import {
  GENERATED_FILE_NOTICE,
  generateContainerModule,
  generateContainerTypeDefinition,
  generateManifestTypeDefinition,
  generateScopeAugmentationDefinition,
} from "./codegen";
import type {
  AlloyManifest,
  DiscoveredMeta,
  FactoryProviderMeta,
} from "./types";
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
  factoryProviders: FactoryProviderMeta[];
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

export interface PreparedContainerData {
  metas: DiscoveredMeta[];
  lazyClassKeys: Set<string>;
  providerImports: string[];
  loadedManifests: Awaited<ReturnType<typeof readManifests>>["loadedManifests"];
}

export async function loadVirtualContainerModule(
  options: LoadVirtualContainerOptions,
): Promise<{ code: string; moduleType: "js" }> {
  const prepared = await prepareContainerData(options);

  const code = generateContainerModule(
    prepared.metas,
    prepared.lazyClassKeys,
    prepared.providerImports,
    {
      isDev: options.isDevMode,
      scopes: options.scopes,
    },
  );

  writeDeclarationArtifacts({
    metas: prepared.metas,
    loadedManifests: prepared.loadedManifests,
    resolvedRoot: options.resolvedRoot,
    containerDeclarationDir: options.containerDeclarationDir,
    scopes: options.scopes,
  });

  writeVisualizationArtifact(
    prepared.metas,
    prepared.lazyClassKeys,
    options.factoryProviders,
    options.resolvedVisualization,
    options.scopes,
  );

  return { code, moduleType: "js" };
}

export async function prepareContainerData(
  options: LoadVirtualContainerOptions,
): Promise<PreparedContainerData> {
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

  return {
    metas,
    loadedManifests,
    lazyClassKeys,
    providerImports,
  };
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

export interface WriteDeclarationArtifactsOptions {
  metas: DiscoveredMeta[];
  loadedManifests: Awaited<ReturnType<typeof readManifests>>["loadedManifests"];
  resolvedRoot: string;
  containerDeclarationDir?: string;
  scopes?: AlloyScopesConfig;
}

export function writeDeclarationArtifacts(
  options: WriteDeclarationArtifactsOptions,
): void {
  const { metas, loadedManifests, resolvedRoot, containerDeclarationDir } =
    options;
  const dtsDir = path.resolve(resolvedRoot, containerDeclarationDir ?? "./src");
  const dtsContent = generateContainerTypeDefinition(metas, (filePath) =>
    resolveDeclarationImportPath(dtsDir, filePath),
  );

  if (!fs.existsSync(dtsDir)) {
    fs.mkdirSync(dtsDir, { recursive: true });
  }

  writeFileIfChanged(path.join(dtsDir, "alloy-container.d.ts"), dtsContent);

  // The AlloyScopes augmentation lives in its own file: it must be a module
  // (module augmentation), while the container declaration must remain a global
  // script so `virtual:alloy-container` resolves everywhere.
  const scopeAugmentationPath = path.join(dtsDir, "alloy-scopes.d.ts");
  const scopeAugmentation = generateScopeAugmentationDefinition(
    options.scopes ? Object.keys(options.scopes) : [],
  );
  if (scopeAugmentation) {
    writeFileIfChanged(scopeAugmentationPath, scopeAugmentation);
  } else if (fs.existsSync(scopeAugmentationPath)) {
    // Remove a stale augmentation when scopes are no longer configured.
    fs.rmSync(scopeAugmentationPath);
  }

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
  factoryProviders: FactoryProviderMeta[],
  resolvedVisualization: ResolvedVisualizationOptions | null,
  scopes: AlloyScopesConfig | undefined,
): void {
  if (!resolvedVisualization) {
    return;
  }

  const artifact = generateMermaidDiagram({
    metas,
    lazyClassKeys: new Set(lazyReferencedClassKeys),
    factoryProviders,
    options: resolvedVisualization.mermaidOptions,
    scopes,
  });
  ensureDirectoryForFile(resolvedVisualization.outputPath);
  writeFileIfChanged(
    resolvedVisualization.outputPath,
    `%% ${GENERATED_FILE_NOTICE}\n${artifact.diagram}\n`,
  );
}

import path from "node:path";
import {
  createClassKey,
  normalizeImportPath,
  hashString,
  createSymbolKey,
} from "./utils";
import type { DiscoveredMeta, DependencyDescriptor } from "./types";
import { IdentifierResolver } from "./identifier-resolver";

export interface ResolvedRegistration extends DiscoveredMeta {
  importName: string;
  isFactoryLazy: boolean;
  identifierConst: string;
  exportKey: string;
  symbolDescription: string;
  optionsText: string; // Reconstructed
}

export interface RegistrationEntry {
  ctorName: string;
  metaText: string;
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "\\'");
}

/**
 * Generates a unique export key for the service identifier map.
 * If there are name collisions (multiple classes with same name), it appends a hash of the file path.
 */
function createIdentifierExportKey(
  meta: DiscoveredMeta,
  resolver: IdentifierResolver,
): string {
  if (resolver.count(meta.className) <= 1) {
    return meta.className;
  }

  const normalizedPath = normalizeImportPath(meta.filePath);
  const hash = hashString(normalizedPath);
  return `${meta.className}_${hash}`;
}

function createSymbolDescription(meta: DiscoveredMeta): string {
  return createSymbolKey(meta.filePath, meta.className);
}

export interface ResolvedDependencyImport {
  localName: string; // The name to use in the virtual module
  importPath: string; // The normalized absolute path to import from
  originalName?: string; // The export name (or default)
}

/**
 * Analyzes dependencies across all discovered services and resolves imports.
 * Deduplicates imports and handles naming collisions by generating unique local names.
 */
function resolveDependencyImports(metas: DiscoveredMeta[]): {
  dependencyImports: ResolvedDependencyImport[];
  importMap: Map<string, ResolvedDependencyImport>;
} {
  const importMap = new Map<string, ResolvedDependencyImport>();
  const nameCounts = new Map<string, number>();

  const getUniqueName = (name: string) => {
    const count = nameCounts.get(name) ?? 0;
    nameCounts.set(name, count + 1);
    return count === 0 ? name : `${name}_${count}`;
  };

  for (const meta of metas) {
    if (!meta.referencedImports?.length) {
      continue;
    }
    for (const ref of meta.referencedImports) {
      if (ref.isTypeOnly) {
        continue;
      }
      const normalizedPath = normalizeImportPath(
        ref.path.startsWith(".")
          ? path.resolve(path.dirname(meta.filePath), ref.path)
          : ref.path,
      );
      const key = `${normalizedPath}::${ref.originalName ?? "default"}`;
      if (importMap.has(key)) {
        continue;
      }
      importMap.set(key, {
        localName: getUniqueName(ref.name),
        importPath: normalizedPath,
        originalName: ref.originalName,
      });
    }
  }

  return {
    dependencyImports: Array.from(importMap.values()),
    importMap,
  };
}

function reconstructDependencyExpression(
  dep: DependencyDescriptor,
  rewriter: (s: string) => string,
  contextDir: string,
): string {
  let expr = dep.expression;

  for (const ident of dep.referencedIdentifiers) {
    const replacement = rewriter(ident);
    if (replacement && replacement !== ident) {
      expr = expr.replace(new RegExp(`\\b${ident}\\b`, "g"), replacement);
    }
  }

  if (dep.isLazy) {
    expr = expr.replace(
      /import\s*\(\s*(['"])(.+?)\1\s*\)/g,
      (match, quote, importPath) => {
        if (importPath.startsWith(".")) {
          const abs = path.resolve(contextDir, importPath);
          const norm = normalizeImportPath(abs);
          return `import(${quote}${norm}${quote})`;
        }
        return match;
      },
    );
  }

  return expr;
}

function reconstructOptionsText(
  meta: DiscoveredMeta,
  importMap: Map<string, ResolvedDependencyImport>,
): string {
  const { scope, dependencies, factory } = meta.metadata;
  const parts: string[] = [];

  if (factory) {
    const expr = reconstructDependencyExpression(
      factory,
      () => "",
      path.dirname(meta.filePath),
    );
    parts.push(`factory: ${expr}`);
  }

  if (scope === "singleton") {
    parts.push(`scope: 'singleton'`);
  }

  if (dependencies && dependencies.length > 0) {
    const depExprs = dependencies.map((dep) => {
      return reconstructDependencyExpression(
        dep,
        (ident) => {
          const ref = meta.referencedImports?.find(
            (r) => r.name === ident && !r.isTypeOnly,
          );
          if (ref) {
            const dir = path.dirname(meta.filePath);
            const absPath = ref.path.startsWith(".")
              ? path.resolve(dir, ref.path)
              : ref.path;
            const normalizedPath = normalizeImportPath(absPath);
            const key = `${normalizedPath}::${ref.originalName ?? "default"}`;
            const resolved = importMap.get(key);
            return resolved ? resolved.localName : ident;
          }
          return ident;
        },
        path.dirname(meta.filePath),
      );
    });
    parts.push(`dependencies: () => [${depExprs.join(", ")}]`);
  }

  if (parts.length === 0) {
    return "{}";
  }
  return `{ ${parts.join(", ")} }`;
}

function buildImportsAndRegistrations(
  metas: DiscoveredMeta[],
  lazyReferencedClassKeys: Set<string>,
  hasProviderModules: boolean,
): {
  runtimeImportStatement: string;
  registrationsBlock: string;
  stubsBlock: string;
  identifierExportBlock: string;
} {
  const activeMetas = filterActiveMetas(metas, lazyReferencedClassKeys);
  const { dependencyImports, importMap } =
    resolveDependencyImports(activeMetas);
  const resolver = new IdentifierResolver(activeMetas);
  const resolvedRegistrations = enrichRegistrations(
    activeMetas,
    resolver,
    importMap,
  );
  const runtimeImports = computeRuntimeImports(
    resolvedRegistrations,
    hasProviderModules,
  );
  const runtimeImportStatement = formatRuntimeImportStatement(runtimeImports);
  const stubsBlock = createStubBlock(
    dependencyImports,
    resolvedRegistrations,
    runtimeImports,
  );
  const registrationEntries = buildRegistrationEntries(resolvedRegistrations);
  const registrationsBlock = createRegistrationsBlock(registrationEntries);
  const identifierExportBlock = createIdentifierExports(resolvedRegistrations);

  return {
    runtimeImportStatement,
    registrationsBlock,
    stubsBlock,
    identifierExportBlock,
  };
}

function filterActiveMetas(
  metas: DiscoveredMeta[],
  lazyReferencedClassKeys: Set<string>,
): DiscoveredMeta[] {
  return metas.filter(
    (meta) =>
      !lazyReferencedClassKeys.has(
        createClassKey(meta.filePath, meta.className),
      ),
  );
}

function enrichRegistrations(
  activeMetas: DiscoveredMeta[],
  resolver: IdentifierResolver,
  importMap: Map<string, ResolvedDependencyImport>,
): ResolvedRegistration[] {
  return activeMetas.map((meta) => {
    const importName = resolver.resolve(meta.className, meta.filePath);
    const identifierConst = `${importName}Identifier`;
    const exportKey = createIdentifierExportKey(meta, resolver);
    const symbolDescription =
      meta.identifierKey ?? createSymbolDescription(meta);
    const optionsText = reconstructOptionsText(meta, importMap);

    return {
      ...meta,
      importName,
      isFactoryLazy: Boolean(meta.metadata.factory),
      identifierConst,
      exportKey,
      symbolDescription,
      optionsText,
    };
  });
}

function computeRuntimeImports(
  registrations: ResolvedRegistration[],
  hasProviderModules: boolean,
): Set<string> {
  const imports = new Set<string>(["Container", "dependenciesRegistry"]);
  const needsLazyImport = registrations.some(
    (m) =>
      m.metadata.dependencies.some((d) => d.isLazy) || !!m.metadata.factory,
  );
  if (hasProviderModules) {
    imports.add("applyProviders");
  }
  if (needsLazyImport) {
    imports.add("Lazy");
  }
  if (registrations.length) {
    imports.add("registerServiceIdentifier");
  }
  return imports;
}

function formatRuntimeImportStatement(imports: Set<string>): string {
  return `\nimport { ${Array.from(imports).join(", ")} } from 'alloy-di/runtime';\n`;
}

function createStubBlock(
  dependencyImports: ResolvedDependencyImport[],
  registrations: ResolvedRegistration[],
  runtimeImports: Set<string>,
): string {
  const statements: string[] = [];
  const importedNames = new Set<string>(runtimeImports);

  for (const dep of dependencyImports) {
    if (
      dep.importPath === "alloy-di/runtime" &&
      dep.originalName &&
      dep.localName === dep.originalName &&
      runtimeImports.has(dep.originalName)
    ) {
      continue;
    }
    if (importedNames.has(dep.localName)) {
      continue;
    }
    statements.push(createDependencyImportStatement(dep));
    importedNames.add(dep.localName);
  }

  for (const meta of registrations) {
    if (meta.isFactoryLazy) {
      statements.push(`class ${meta.importName} {}`);
      continue;
    }
    if (importedNames.has(meta.importName)) {
      continue;
    }
    statements.push(createServiceImportStatement(meta));
    importedNames.add(meta.importName);
  }

  return statements.length ? `${statements.join("\n")}\n` : "";
}

function createDependencyImportStatement(
  dep: ResolvedDependencyImport,
): string {
  if (dep.originalName === "default") {
    return `import ${dep.localName} from '${dep.importPath}';`;
  }
  if (dep.originalName === "*") {
    return `import * as ${dep.localName} from '${dep.importPath}';`;
  }
  if (dep.originalName && dep.originalName !== dep.localName) {
    return `import { ${dep.originalName} as ${dep.localName} } from '${dep.importPath}';`;
  }
  return `import { ${dep.localName} } from '${dep.importPath}';`;
}

function createServiceImportStatement(meta: ResolvedRegistration): string {
  const isBareSpecifier =
    !/^(\/|[A-Za-z]:\\|\.|~)/.test(meta.filePath) &&
    !meta.filePath.includes("\\");
  const importPath = isBareSpecifier
    ? meta.filePath
    : normalizeImportPath(meta.filePath);
  if (meta.importName === meta.className) {
    return `import { ${meta.className} } from '${importPath}';`;
  }
  return `import { ${meta.className} as ${meta.importName} } from '${importPath}';`;
}

function buildRegistrationEntries(
  registrations: ResolvedRegistration[],
): RegistrationEntry[] {
  return registrations.map((m) => ({
    ctorName: m.importName,
    metaText: m.optionsText,
  }));
}

function createRegistrationsBlock(entries: RegistrationEntry[]): string {
  if (!entries.length) {
    return "const registrations = [];";
  }
  const lines = entries
    .map((entry) => `  { ctor: ${entry.ctorName}, meta: ${entry.metaText} }`)
    .join(",\n");
  return `const registrations = [\n${lines}\n];`;
}

function createIdentifierExports(
  registrations: ResolvedRegistration[],
): string {
  if (!registrations.length) {
    return "export const serviceIdentifiers = {};\n";
  }
  const declarations = registrations
    .map(
      (meta) =>
        `const ${meta.identifierConst} = registerServiceIdentifier(${meta.importName}, Symbol.for('${escapeSingleQuotes(meta.symbolDescription)}'));`,
    )
    .join("\n");
  const entries = registrations
    .map((meta) => `  '${meta.exportKey}': ${meta.identifierConst}`)
    .join(",\n");
  return `${declarations}\n\nexport const serviceIdentifiers = {\n${entries}\n};\n`;
}

export const __codegenInternals = {
  computeRuntimeImports,
  createStubBlock,
  createRegistrationsBlock,
};

/**
 * Generates the virtual container module code.
 * This module:
 * 1. Imports the runtime container and necessary helpers.
 * 2. Imports all discovered service classes (or creates stubs for factory-lazy services).
 * 3. Registers each service with the global `dependenciesRegistry`.
 * 4. Applies any configured providers.
 * 5. Exports the configured `Container` instance as default.
 * 6. Exports `serviceIdentifiers` map for consumers to use safe injection keys.
 *
 * @param metas - List of discovered services.
 * @param lazyReferencedClassKeys - Set of service keys that are referenced ONLY lazily (and thus should not be imported/registered eagerly in this bundle).
 * @param providerModulePaths - List of provider modules to import and apply.
 */
export function generateContainerModule(
  metas: DiscoveredMeta[],
  lazyReferencedClassKeys: Set<string>,
  providerModulePaths: string[],
): string {
  const hasProviderModules = providerModulePaths.length > 0;
  const {
    runtimeImportStatement,
    registrationsBlock,
    stubsBlock,
    identifierExportBlock,
  } = buildImportsAndRegistrations(
    metas,
    lazyReferencedClassKeys,
    hasProviderModules,
  );

  let providerImportBlock = "";
  let providerInvocationBlock = "";

  if (hasProviderModules) {
    const aliasNames = providerModulePaths.map((_, idx) => `providers_${idx}`);
    providerImportBlock =
      providerModulePaths
        .map((p, idx) => `import ${aliasNames[idx]} from '${p}';`)
        .join("\n") + "\n";
    providerInvocationBlock = `\nconst providerDefinitions = [${aliasNames.join(
      ", ",
    )}];\nfor (const definition of providerDefinitions) {\n  applyProviders(container, definition);\n}\n`;
  }

  return `
${runtimeImportStatement}${stubsBlock}
${providerImportBlock}
${registrationsBlock}

const container = new Container();

for (const entry of registrations) {
  dependenciesRegistry.set(entry.ctor, entry.meta);
}
${providerInvocationBlock}${identifierExportBlock}
export default container;
`;
}

/**
 * Generates the TypeScript declaration definition (`.d.ts`) for the virtual container module.
 * It exports the `ServiceIdentifiers` interface matching the runtime exports.
 *
 * @param metas - List of discovered services.
 * @param pathResolver - Function to resolve absolute file paths to import paths relative to the declaration file location.
 */
export function generateContainerTypeDefinition(
  metas: DiscoveredMeta[],
  pathResolver: (path: string) => string,
): string {
  const resolver = new IdentifierResolver(metas);

  // Resolve imports
  const imports: string[] = [];
  const interfaceMembers: string[] = [];

  for (const meta of metas) {
    const importName = resolver.resolve(meta.className, meta.filePath);
    const importPath = pathResolver(meta.filePath);

    // If the class name matches the import name, we can use a simple import
    if (importName === meta.className) {
      imports.push(`import { ${meta.className} } from '${importPath}';`);
    } else {
      imports.push(
        `import { ${meta.className} as ${importName} } from '${importPath}';`,
      );
    }

    const exportKey = createIdentifierExportKey(meta, resolver);
    interfaceMembers.push(`${exportKey}: ServiceIdentifier<${importName}>;`);
  }

  const importsBlock = imports.length ? imports.join("\n") + "\n" : "";
  const membersBlock = interfaceMembers.length
    ? interfaceMembers.join("\n    ")
    : "";

  return `
declare module "virtual:alloy-container" {
  import { Container, ServiceIdentifier } from "alloy-di/runtime";
  ${importsBlock}
  export interface ServiceIdentifiers {
    ${membersBlock}
  }

  export const serviceIdentifiers: ServiceIdentifiers;

  const container: Container;
  export default container;
}
`;
}

export interface ManifestTypeInfo {
  packageName: string;
  services: { exportName: string }[];
}

/**
 * Generates ambient type declarations for external Alloy manifests consumed by the project.
 * Creates:
 * 1. `declare module "PKG/manifest"` typed as `LibraryManifest`.
 * 2. `declare module "PKG/service-identifiers"` exporting typed `ServiceIdentifier` constants.
 *
 * @param manifests - List of loaded manifest info (packageName and services).
 */
export function generateManifestTypeDefinition(
  manifests: ManifestTypeInfo[],
): string {
  const moduleDeclarations = manifests
    .map((m) => {
      const serviceIdentifiers = m.services
        .map(
          (s) => `  export const ${s.exportName}Identifier: ServiceIdentifier;`,
        )
        .join("\n");

      return `
declare module "${m.packageName}/manifest" {
  type ServiceScope = "singleton" | "transient";

  interface ManifestLazyDependency {
    exportName: string;
    importPath: string;
    retry?: {
      retries: number;
      backoffMs?: number;
      factor?: number;
    };
  }

  interface ManifestTokenDependency {
    exportName: string;
    importPath: string;
    symbolKey?: string;
  }

  interface ManifestService {
    exportName: string;
    importPath: string;
    symbolKey: string;
    scope: ServiceScope;
    deps: string[];
    lazyDeps: ManifestLazyDependency[];
    tokenDeps?: ManifestTokenDependency[];
  }

  interface LibraryManifest {
    schemaVersion: number;
    packageName: string;
    buildMode: "preserve-modules" | "bundled" | "chunks";
    services: ManifestService[];
    providers: string[];
    diagnostics?: Record<string, unknown>;
  }

  export const manifest: LibraryManifest;
  export default manifest;
}

declare module "${m.packageName}/service-identifiers" {
  import { ServiceIdentifier } from "alloy-di/runtime";
${serviceIdentifiers}
}
`;
    })
    .join("\n");

  return moduleDeclarations;
}

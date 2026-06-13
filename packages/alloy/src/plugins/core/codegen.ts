import path from "node:path";
import ts from "typescript";
import {
  createClassKey,
  normalizeImportPath,
  hashString,
  createSymbolKey,
} from "./utils";
import type { DiscoveredMeta, DependencyDescriptor } from "./types";
import type { AlloyScopesConfig } from "./scopes-validation";
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
  return value.replaceAll("'", "\\'");
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
  /**
   * True when the local name refers to a binding that already exists in the
   * generated module (a runtime helper, a service import, or a factory-lazy
   * stub), so no import statement must be emitted for it.
   */
  reusesExistingBinding?: boolean;
}

/**
 * Allocates module-local names from a single shared pool so the generated
 * module's independent naming domains (runtime helpers, service imports,
 * factory-lazy stubs, dependency imports, identifier consts, generated
 * locals) can never collide.
 */
function createNamePool(reservedNames: Iterable<string>) {
  const used = new Set(reservedNames);
  return {
    claim(base: string): string {
      let candidate = base;
      let suffix = 1;
      while (used.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix++;
      }
      used.add(candidate);
      return candidate;
    },
  };
}

type NamePool = ReturnType<typeof createNamePool>;

function stripModuleExtension(importPath: string): string {
  return importPath.replace(/\.[cm]?[jt]sx?$/i, "");
}

/**
 * Identity of an imported binding: the module (extension-insensitive, since
 * references may resolve extensionless while service paths keep theirs) plus
 * the export name.
 */
function createBindingKey(importPath: string, exportName: string): string {
  return `${stripModuleExtension(importPath)}::${exportName}`;
}

type ReferencedImport = NonNullable<
  DiscoveredMeta["referencedImports"]
>[number];

/** Resolves a referenced import's specifier to a normalized module path. */
function resolveReferencePath(
  ref: ReferencedImport,
  meta: DiscoveredMeta,
): string {
  return normalizeImportPath(
    ref.path.startsWith(".")
      ? path.resolve(path.dirname(meta.filePath), ref.path)
      : ref.path,
  );
}

function resolveDependencyImport(
  ref: ReferencedImport,
  normalizedPath: string,
  pool: NamePool,
  serviceBindings: Map<string, string>,
  runtimeImports: Set<string>,
): ResolvedDependencyImport {
  // Reuse the runtime helper binding instead of re-importing it.
  if (
    normalizedPath === "alloy-di/runtime" &&
    ref.originalName &&
    ref.name === ref.originalName &&
    runtimeImports.has(ref.originalName)
  ) {
    return {
      localName: ref.originalName,
      importPath: normalizedPath,
      originalName: ref.originalName,
      reusesExistingBinding: true,
    };
  }

  // Reuse the service import (or factory-lazy stub) binding when the
  // dependency resolves to a registered service.
  const serviceLocalName = serviceBindings.get(
    createBindingKey(normalizedPath, ref.originalName ?? "default"),
  );
  if (serviceLocalName) {
    return {
      localName: serviceLocalName,
      importPath: normalizedPath,
      originalName: ref.originalName,
      reusesExistingBinding: true,
    };
  }

  return {
    localName: pool.claim(ref.name),
    importPath: normalizedPath,
    originalName: ref.originalName,
  };
}

/**
 * Analyzes dependencies across all discovered services and resolves imports.
 * Deduplicates imports by binding identity, reuses bindings the module
 * already declares (runtime helpers, service imports, factory-lazy stubs),
 * and claims fresh local names from the shared pool otherwise.
 */
function resolveDependencyImports(
  metas: DiscoveredMeta[],
  pool: NamePool,
  serviceBindings: Map<string, string>,
  runtimeImports: Set<string>,
): {
  dependencyImports: ResolvedDependencyImport[];
  importMap: Map<string, ResolvedDependencyImport>;
} {
  const importMap = new Map<string, ResolvedDependencyImport>();

  for (const meta of metas) {
    for (const ref of meta.referencedImports ?? []) {
      if (ref.isTypeOnly) {
        continue;
      }
      const normalizedPath = resolveReferencePath(ref, meta);
      const key = createBindingKey(
        normalizedPath,
        ref.originalName ?? "default",
      );
      if (importMap.has(key)) {
        continue;
      }
      importMap.set(
        key,
        resolveDependencyImport(
          ref,
          normalizedPath,
          pool,
          serviceBindings,
          runtimeImports,
        ),
      );
    }
  }

  return {
    dependencyImports: Array.from(importMap.values()),
    importMap,
  };
}

interface IdentifierEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * True when an identifier occupies a name position rather than referencing a
 * binding: property-access names (`ns.Api`), object keys — including method
 * and accessor keys (`{ Api() {} }`, `{ get Api() {} }`) — class member
 * names, qualified names, and destructuring property names.
 */
function isNonReferencePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.name === node;
  }
  if (ts.isQualifiedName(parent)) {
    return parent.right === node;
  }
  if (ts.isBindingElement(parent)) {
    return parent.propertyName === node;
  }
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isPropertySignature(parent)
  ) {
    return parent.name === node;
  }
  return false;
}

/**
 * Decide how to rewrite one identifier node, or skip it.
 *
 * Only binding references are rewritten: name positions and string/comment
 * content keep their text. Shorthand properties expand
 * (`{ Api }` -> `{ Api: Api_1 }`) so the key survives the rename.
 */
function createIdentifierEdit(
  node: ts.Identifier,
  source: ts.SourceFile,
  replacement: string,
): IdentifierEdit | undefined {
  const parent = node.parent;
  if (isNonReferencePosition(node)) {
    return undefined;
  }

  const start = node.getStart(source);
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    return { start, end: node.end, text: `${node.text}: ${replacement}` };
  }
  return { start, end: node.end, text: replacement };
}

/**
 * Rewrite identifier references inside a reconstructed dependency expression.
 *
 * The expression is parsed and identifier nodes are replaced by position, so
 * `$`-prefixed names rewrite correctly and occurrences inside string literals
 * (e.g. lazy `import('/src/Api')` specifiers) and comments are untouched —
 * the previous `\b`-regex text replacement got both wrong.
 */
function rewriteReferencedIdentifiers(
  expression: string,
  referenced: ReadonlySet<string>,
  rewriter: (ident: string) => string,
): string {
  // Wrap in parentheses so expressions that start like statements (e.g.
  // object literals) parse as expressions.
  const wrapped = `(${expression});`;
  const source = ts.createSourceFile(
    "alloy-dependency-expression.ts",
    wrapped,
    ts.ScriptTarget.ESNext,
    true,
  );

  const edits: IdentifierEdit[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && referenced.has(node.text)) {
      const replacement = rewriter(node.text);
      if (replacement && replacement !== node.text) {
        const edit = createIdentifierEdit(node, source, replacement);
        if (edit) {
          edits.push(edit);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  let result = wrapped;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result.slice(1, -2);
}

function reconstructDependencyExpression(
  dep: DependencyDescriptor,
  rewriter: (s: string) => string,
  contextDir: string,
): string {
  let expr = dep.expression;

  if (dep.referencedIdentifiers.length > 0) {
    expr = rewriteReferencedIdentifiers(
      expr,
      new Set(dep.referencedIdentifiers),
      rewriter,
    );
  }

  if (dep.isLazy) {
    expr = expr.replaceAll(
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
  serviceRenames: Map<string, string>,
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
            const key = createBindingKey(
              resolveReferencePath(ref, meta),
              ref.originalName ?? "default",
            );
            const resolved = importMap.get(key);
            return resolved ? resolved.localName : ident;
          }
          // Identifiers without an import reference a service binding in the
          // generated module; follow any pool-driven rename.
          return serviceRenames.get(ident) ?? ident;
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
  providerModulePaths: string[],
  options?: GenerateContainerModuleOptions,
): {
  runtimeImportStatement: string;
  registrationsBlock: string;
  stubsBlock: string;
  identifierExportBlock: string;
} {
  const hasProviderModules = providerModulePaths.length > 0;
  const activeMetas = filterActiveMetas(metas, lazyReferencedClassKeys);
  const resolver = new IdentifierResolver(activeMetas);
  const runtimeImports = computeRuntimeImports(
    activeMetas,
    hasProviderModules,
    options?.isDev !== undefined,
  );

  const pool = createNamePool([
    ...runtimeImports,
    "registrations",
    "container",
    "providerDefinitions",
    ...providerModulePaths.map((_, idx) => `providers_${idx}`),
  ]);

  // Services claim their names first: dependency expressions may reference
  // them by resolver name (same-file dependencies, manifest class deps), so
  // their names take priority and colliding dependency imports get renamed.
  const serviceNames = new Map<DiscoveredMeta, string>();
  const serviceRenames = new Map<string, string>();
  const serviceBindings = new Map<string, string>();
  for (const meta of activeMetas) {
    const baseName = resolver.resolve(meta.className, meta.filePath);
    const name = pool.claim(baseName);
    serviceNames.set(meta, name);
    if (name !== baseName) {
      serviceRenames.set(baseName, name);
    }
    serviceBindings.set(
      createBindingKey(getServiceImportPath(meta), meta.className),
      name,
    );
  }

  const { dependencyImports, importMap } = resolveDependencyImports(
    activeMetas,
    pool,
    serviceBindings,
    runtimeImports,
  );
  const resolvedRegistrations = enrichRegistrations(activeMetas, {
    resolver,
    serviceNames,
    serviceRenames,
    importMap,
    pool,
  });
  const runtimeImportStatement = formatRuntimeImportStatement(runtimeImports);
  const stubsBlock = createStubBlock(dependencyImports, resolvedRegistrations);
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

interface RegistrationNaming {
  resolver: IdentifierResolver;
  serviceNames: Map<DiscoveredMeta, string>;
  serviceRenames: Map<string, string>;
  importMap: Map<string, ResolvedDependencyImport>;
  pool: NamePool;
}

function enrichRegistrations(
  activeMetas: DiscoveredMeta[],
  naming: RegistrationNaming,
): ResolvedRegistration[] {
  const { resolver, serviceNames, serviceRenames, importMap, pool } = naming;
  return activeMetas.map((meta) => {
    const importName = serviceNames.get(meta) ?? meta.className;
    const identifierConst = pool.claim(`${importName}Identifier`);
    const exportKey = createIdentifierExportKey(meta, resolver);
    const symbolDescription =
      meta.identifierKey ?? createSymbolDescription(meta);
    const optionsText = reconstructOptionsText(meta, importMap, serviceRenames);

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
  activeMetas: DiscoveredMeta[],
  hasProviderModules: boolean,
  hasEnvOverrides = false,
): Set<string> {
  const imports = new Set<string>(["Container", "dependenciesRegistry"]);
  if (hasEnvOverrides) {
    imports.add("setEnvDetectionOverrides");
  }
  const needsLazyImport = activeMetas.some(
    (m) =>
      m.metadata.dependencies.some((d) => d.isLazy) || !!m.metadata.factory,
  );
  if (hasProviderModules) {
    imports.add("applyProviders");
  }
  if (needsLazyImport) {
    imports.add("Lazy");
  }
  if (activeMetas.length) {
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
): string {
  const statements: string[] = [];

  // Name uniqueness is guaranteed by the shared pool, so every entry that
  // does not reuse an existing binding emits exactly one statement.
  for (const dep of dependencyImports) {
    if (dep.reusesExistingBinding) {
      continue;
    }
    statements.push(createDependencyImportStatement(dep));
  }

  for (const meta of registrations) {
    if (meta.isFactoryLazy) {
      statements.push(`class ${meta.importName} {}`);
      continue;
    }
    statements.push(createServiceImportStatement(meta));
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

function getServiceImportPath(meta: DiscoveredMeta): string {
  const isBareSpecifier =
    !/^(\/|[A-Za-z]:\\|\.|~)/.test(meta.filePath) &&
    !meta.filePath.includes("\\");
  return isBareSpecifier ? meta.filePath : normalizeImportPath(meta.filePath);
}

function createServiceImportStatement(meta: ResolvedRegistration): string {
  const importPath = getServiceImportPath(meta);
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

export interface GenerateContainerModuleOptions {
  isDev?: boolean;
  /** Declared custom scope hierarchy; emitted as a runtime registration. */
  scopes?: AlloyScopesConfig;
}

/**
 * Builds the runtime scope-hierarchy registration statement. The generated
 * container records the declared parent of each custom scope so child scopes
 * constructed via `alloy-di/scopes` can be validated against the build-time
 * hierarchy. Returns an empty string when no custom scopes are configured.
 */
function createScopeHierarchyBlock(
  scopes: AlloyScopesConfig | undefined,
): string {
  if (!scopes) {
    return "";
  }
  const names = Object.keys(scopes);
  if (!names.length) {
    return "";
  }
  const entries = names
    .map(
      (name) =>
        `  ${JSON.stringify(name)}: ${JSON.stringify(scopes[name].parent)}`,
    )
    .join(",\n");
  return `\ncontainer._registerScopeHierarchy({\n${entries}\n});\n`;
}

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
  options?: GenerateContainerModuleOptions,
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
    providerModulePaths,
    options,
  );

  const envOverridesBlock =
    options?.isDev === undefined
      ? ""
      : `\nsetEnvDetectionOverrides({ isDev: ${options.isDev} });\n`;

  const scopeHierarchyBlock = createScopeHierarchyBlock(options?.scopes);

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
${runtimeImportStatement}${envOverridesBlock}${stubsBlock}
${providerImportBlock}
${registrationsBlock}

const container = new Container();
${scopeHierarchyBlock}
for (const entry of registrations) {
  dependenciesRegistry.set(entry.ctor, entry.meta);
}
${providerInvocationBlock}${identifierExportBlock}
export default container;
`;
}

export const GENERATED_FILE_NOTICE =
  "This file was auto-generated by Alloy. Manual changes will be overwritten.";

export const GENERATED_FILE_HEADER = `/**
 * ${GENERATED_FILE_NOTICE}
 */
`;

/**
 * Generates the TypeScript declaration definition (`.d.ts`) for the virtual container module.
 * It exports the `ServiceIdentifiers` interface matching the runtime exports.
 *
 * @param metas - List of discovered services.
 * @param pathResolver - Function to resolve absolute file paths to import paths relative to the declaration file location.
 * @param scopeNames - Custom scope names to register as `AlloyScopes` keys, making `@Injectable('<scope>')` type-check.
 */
export function generateContainerTypeDefinition(
  metas: DiscoveredMeta[],
  pathResolver: (path: string) => string,
  scopeNames: string[] = [],
): string {
  const resolver = new IdentifierResolver(metas);
  // The declaration module imports Container and ServiceIdentifier from the
  // runtime, so service type imports claim their names from a pool seeded
  // with those bindings (mirroring the generated module's name allocation).
  const pool = createNamePool(["Container", "ServiceIdentifier", "container"]);

  // Resolve imports
  const imports: string[] = [];
  const interfaceMembers: string[] = [];

  for (const meta of metas) {
    const importName = pool.claim(
      resolver.resolve(meta.className, meta.filePath),
    );
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

  return `${GENERATED_FILE_HEADER}
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
${generateScopeAugmentation(scopeNames)}`;
}

/**
 * Generates the module augmentation that registers custom scope names as keys
 * of `AlloyScopes`, opening the `ServiceScope` union so `@Injectable('session')`
 * type-checks. Returns an empty string when no custom scopes are configured.
 */
function generateScopeAugmentation(scopeNames: string[]): string {
  if (!scopeNames.length) {
    return "";
  }
  const members = scopeNames
    .map((name) => `    ${JSON.stringify(name)}: true;`)
    .join("\n");
  return `
declare module "alloy-di/runtime" {
  interface AlloyScopes {
${members}
  }
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

  interface ManifestLegacyLazyDependency {
    exportName: string;
    importPath: string;
    retry?: {
      retries: number;
      backoffMs?: number;
      factor?: number;
    };
  }

  interface ManifestLegacyTokenDependency {
    exportName: string;
    importPath: string;
    symbolKey?: string;
  }

  interface ManifestClassDependency {
    kind: "class";
    exportName: string;
  }

  interface ManifestTokenDependency {
    kind: "token";
    exportName: string;
    importPath: string;
    symbolKey?: string;
  }

  interface ManifestLazyDependency {
    kind: "lazy";
    exportName: string;
    importPath: string;
    retry?: {
      retries: number;
      backoffMs?: number;
      factor?: number;
    };
  }

  type ManifestDependency =
    | ManifestClassDependency
    | ManifestTokenDependency
    | ManifestLazyDependency;

  interface ManifestServiceV1 {
    exportName: string;
    importPath: string;
    symbolKey: string;
    scope: ServiceScope;
    deps: string[];
    lazyDeps: ManifestLegacyLazyDependency[];
    tokenDeps?: ManifestLegacyTokenDependency[];
  }

  interface ManifestServiceV2 {
    exportName: string;
    importPath: string;
    symbolKey: string;
    scope: ServiceScope;
    deps: ManifestDependency[];
  }

  type ManifestService = ManifestServiceV1 | ManifestServiceV2;

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

  return GENERATED_FILE_HEADER + moduleDeclarations;
}

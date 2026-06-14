import fs from "node:fs";
import ts, { SyntaxKind } from "typescript";
import { ServiceScope } from "../../lib/scope";
import { extractServiceMetadata } from "./decorators";
import { processLazyCall, resolveModuleSpecifierCandidates } from "./lazy";
import { createClassKey, createSymbolKey } from "./utils";
import type { DiscoveredMeta, FactoryProviderMeta } from "./types";

export interface ScanResult {
  metas: DiscoveredMeta[];
  lazyClassKeys: Set<string>;
  factoryProviders: FactoryProviderMeta[];
}

export interface ScanSourceOptions {
  factoryProviders?: boolean;
}

interface ImportInfo {
  path: string;
  originalName?: string;
  isTypeOnly?: boolean;
}

type AlloyDecoratorName = "Injectable" | "Singleton";

interface ServiceDecoratorMatch {
  decoratorCall: ts.CallExpression;
  decoratorName: AlloyDecoratorName;
}

type DecoratorResolutionCache = Map<string, AlloyDecoratorName | null>;

const ALLOY_RUNTIME_MODULE = "alloy-di/runtime";

function collectFileImports(
  sourceFile: ts.SourceFile,
): Map<string, ImportInfo> {
  const imports = new Map<string, ImportInfo>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const path = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      const isTypeOnly = clause.phaseModifier === SyntaxKind.TypeKeyword;

      if (clause.name) {
        // Default import
        imports.set(clause.name.text, {
          path,
          originalName: "default",
          isTypeOnly,
        });
      }

      if (clause.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const localName = element.name.text;
            const originalName = element.propertyName
              ? element.propertyName.text
              : localName;
            const elementIsTypeOnly = isTypeOnly || element.isTypeOnly;
            imports.set(localName, {
              path,
              originalName,
              isTypeOnly: elementIsTypeOnly,
            });
          }
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          imports.set(clause.namedBindings.name.text, {
            path,
            originalName: "*",
            isTypeOnly,
          });
        }
      }
    }
  }
  return imports;
}

/**
 * Cheap pre-filter that avoids the TS parse for files that cannot contribute
 * discovery results: decorators require an `@` and lazy references require
 * the `Lazy` identifier.
 */
function shouldScanFactoryProviders(options?: ScanSourceOptions): boolean {
  return options?.factoryProviders ?? true;
}

function mayContainDiscoverableSyntax(
  code: string,
  options?: ScanSourceOptions,
): boolean {
  return (
    code.includes("@") ||
    code.includes("Lazy") ||
    (shouldScanFactoryProviders(options) && code.includes("asFactory"))
  );
}

/** Exported for tests only. */
export const __scannerInternals = { mayContainDiscoverableSyntax };

export function scanSource(
  code: string,
  id: string,
  options?: ScanSourceOptions,
): ScanResult {
  const scanFactoryProviders = shouldScanFactoryProviders(options);
  if (!mayContainDiscoverableSyntax(code, options)) {
    return { metas: [], lazyClassKeys: new Set(), factoryProviders: [] };
  }

  const sourceFile = ts.createSourceFile(
    id,
    code,
    ts.ScriptTarget.ESNext,
    true,
  );
  const discovered = new Map<string, DiscoveredMeta>();
  const lazyRefs = new Set<string>();
  const factoryProviders: FactoryProviderMeta[] = [];
  const fileImports = collectFileImports(sourceFile);
  const decoratorResolutionCache: DecoratorResolutionCache = new Map();

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node)) {
      handleClassDeclaration(node, {
        id,
        sourceFile,
        fileImports,
        discovered,
        decoratorResolutionCache,
      });
    } else if (ts.isCallExpression(node)) {
      processLazyCall(node, id, sourceFile, lazyRefs);
      if (scanFactoryProviders) {
        handleFactoryProviderCall(node, {
          id,
          sourceFile,
          fileImports,
          factoryProviders,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return {
    metas: Array.from(discovered.values()),
    lazyClassKeys: lazyRefs,
    factoryProviders,
  };
}

interface ClassVisitContext {
  id: string;
  sourceFile: ts.SourceFile;
  fileImports: Map<string, ImportInfo>;
  discovered: Map<string, DiscoveredMeta>;
  decoratorResolutionCache: DecoratorResolutionCache;
}

interface FactoryProviderVisitContext {
  id: string;
  sourceFile: ts.SourceFile;
  fileImports: Map<string, ImportInfo>;
  factoryProviders: FactoryProviderMeta[];
}

function handleFactoryProviderCall(
  node: ts.CallExpression,
  context: FactoryProviderVisitContext,
): void {
  if (
    !isAlloyRuntimeHelper(node.expression, "asFactory", context.fileImports)
  ) {
    return;
  }

  const tokenArg = node.arguments[0];
  if (!tokenArg) {
    return;
  }

  context.factoryProviders.push({
    filePath: context.id,
    tokenExpression: tokenArg.getText(context.sourceFile),
    tokenLabel: createFactoryTokenLabel(tokenArg, context.sourceFile),
    lifecycle: extractFactoryLifecycle(node.arguments[2]),
  });
}

function isAlloyRuntimeHelper(
  expression: ts.LeftHandSideExpression,
  helperName: string,
  fileImports: Map<string, ImportInfo>,
): boolean {
  if (ts.isIdentifier(expression)) {
    const importInfo = fileImports.get(expression.text);
    return Boolean(
      importInfo &&
      !importInfo.isTypeOnly &&
      importInfo.path === ALLOY_RUNTIME_MODULE &&
      (importInfo.originalName ?? expression.text) === helperName,
    );
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const importInfo = fileImports.get(expression.expression.text);
    return Boolean(
      importInfo &&
      !importInfo.isTypeOnly &&
      importInfo.path === ALLOY_RUNTIME_MODULE &&
      importInfo.originalName === "*" &&
      expression.name.text === helperName,
    );
  }

  return false;
}

function createFactoryTokenLabel(
  tokenArg: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isIdentifier(tokenArg)) {
    return tokenArg.text;
  }
  return tokenArg.getText(sourceFile);
}

function extractFactoryLifecycle(
  optionsArg: ts.Expression | undefined,
): string {
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) {
    return ServiceScope.SINGLETON;
  }

  for (const prop of optionsArg.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      continue;
    }
    if (prop.name.text !== "lifecycle") {
      continue;
    }
    return lifecycleExpressionToScope(prop.initializer);
  }

  return ServiceScope.SINGLETON;
}

function lifecycleExpressionToScope(expression: ts.Expression): string {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  if (ts.isCallExpression(expression)) {
    const callTarget = expression.expression;
    if (
      ts.isPropertyAccessExpression(callTarget) &&
      (callTarget.name.text === "singleton" ||
        callTarget.name.text === "transient")
    ) {
      return callTarget.name.text;
    }
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const member = expression.name.text;
    if (member === "SINGLETON") {
      return ServiceScope.SINGLETON;
    }
    if (member === "TRANSIENT") {
      return ServiceScope.TRANSIENT;
    }
  }

  return ServiceScope.SINGLETON;
}

function handleClassDeclaration(
  node: ts.ClassDeclaration,
  context: ClassVisitContext,
) {
  if (!node.name) {
    return;
  }
  const decoratorMatch = findServiceDecorator(
    node,
    context.sourceFile,
    context.fileImports,
    context.id,
    context.decoratorResolutionCache,
  );
  if (!decoratorMatch) {
    return;
  }
  const { decoratorCall, decoratorName } = decoratorMatch;
  const className = node.name.getText(context.sourceFile);
  const metadata = extractServiceMetadata(
    decoratorName,
    decoratorCall,
    context.sourceFile,
  );
  const referencedImports = collectReferencedImports(
    metadata,
    context.fileImports,
  );
  const classKey = createClassKey(context.id, className);
  context.discovered.set(classKey, {
    className,
    filePath: context.id,
    identifierKey: createSymbolKey(context.id, className),
    metadata,
    referencedImports,
  });
}

function findServiceDecorator(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  fileImports: Map<string, ImportInfo>,
  id: string,
  resolutionCache: DecoratorResolutionCache,
): ServiceDecoratorMatch | undefined {
  const decorators = ts.getDecorators ? ts.getDecorators(node) : undefined;
  if (!decorators?.length) {
    return undefined;
  }
  for (const decorator of decorators) {
    if (!ts.isCallExpression(decorator.expression)) {
      warnOnBareAlloyDecorator(
        decorator,
        sourceFile,
        fileImports,
        id,
        resolutionCache,
      );
      continue;
    }
    const decoratorName = resolveDecoratorName(
      decorator.expression.expression,
      fileImports,
      id,
      new Set([id]),
      resolutionCache,
    );
    if (decoratorName) {
      return {
        decoratorCall: decorator.expression,
        decoratorName,
      };
    }
  }
  return undefined;
}

/**
 * Warn when an alloy decorator is applied bare (`@Injectable` instead of
 * `@Injectable()`). The scanner only registers call-expression decorators, so
 * the service would silently vanish from the container — and at runtime the
 * factory throws. Surfacing the location here makes the misuse findable at
 * build time.
 */
function warnOnBareAlloyDecorator(
  decorator: ts.Decorator,
  sourceFile: ts.SourceFile,
  fileImports: Map<string, ImportInfo>,
  id: string,
  resolutionCache: DecoratorResolutionCache,
): void {
  if (
    !ts.isIdentifier(decorator.expression) &&
    !ts.isPropertyAccessExpression(decorator.expression)
  ) {
    return;
  }
  const decoratorName = resolveDecoratorName(
    decorator.expression,
    fileImports,
    id,
    new Set([id]),
    resolutionCache,
  );
  if (!decoratorName) {
    return;
  }
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    decorator.getStart(sourceFile),
  );
  const appliedText = decorator.expression.getText(sourceFile);
  console.warn(
    `[alloy] ${id}:${line + 1} applies @${appliedText} without calling it — use @${appliedText}(). The class will not be registered.`,
  );
}

function resolveDecoratorName(
  expression: ts.LeftHandSideExpression,
  fileImports: Map<string, ImportInfo>,
  id: string,
  visitedModules: Set<string>,
  resolutionCache: DecoratorResolutionCache,
): AlloyDecoratorName | undefined {
  if (ts.isIdentifier(expression)) {
    const importInfo = fileImports.get(expression.text);
    if (!importInfo || importInfo.isTypeOnly) {
      return undefined;
    }
    return resolveImportedDecorator(
      importInfo.path,
      importInfo.originalName ?? expression.text,
      id,
      visitedModules,
      resolutionCache,
    );
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const importInfo = fileImports.get(expression.expression.text);
    if (
      !importInfo ||
      importInfo.isTypeOnly ||
      importInfo.originalName !== "*"
    ) {
      return undefined;
    }
    return resolveImportedDecorator(
      importInfo.path,
      expression.name.text,
      id,
      visitedModules,
      resolutionCache,
    );
  }

  return undefined;
}

function resolveImportedDecorator(
  importPath: string,
  requestedName: string,
  fromId: string,
  visitedModules: Set<string>,
  resolutionCache: DecoratorResolutionCache,
): AlloyDecoratorName | undefined {
  if (importPath === ALLOY_RUNTIME_MODULE) {
    return isAlloyDecoratorName(requestedName) ? requestedName : undefined;
  }

  if (!importPath.startsWith(".")) {
    return undefined;
  }

  for (const candidate of resolveModuleSpecifierCandidates(
    fromId,
    importPath,
  )) {
    const cacheKey = `${candidate}:${requestedName}`;
    const cached = resolutionCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (cached === null) {
      continue;
    }
    if (visitedModules.has(candidate) || !fs.existsSync(candidate)) {
      continue;
    }
    visitedModules.add(candidate);
    try {
      const source = fs.readFileSync(candidate, "utf8");
      const sourceFile = ts.createSourceFile(
        candidate,
        source,
        ts.ScriptTarget.ESNext,
        true,
      );
      const fileImports = collectFileImports(sourceFile);
      const resolved = resolveDecoratorExport(
        requestedName,
        sourceFile,
        fileImports,
        candidate,
        visitedModules,
        resolutionCache,
      );
      resolutionCache.set(cacheKey, resolved ?? null);
      if (resolved) {
        return resolved;
      }
    } catch {
      continue;
    } finally {
      visitedModules.delete(candidate);
    }
  }

  return undefined;
}

function resolveDecoratorExport(
  requestedName: string,
  sourceFile: ts.SourceFile,
  fileImports: Map<string, ImportInfo>,
  id: string,
  visitedModules: Set<string>,
  resolutionCache: DecoratorResolutionCache,
): AlloyDecoratorName | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) {
      continue;
    }

    const moduleSpecifier =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;

    if (!statement.exportClause) {
      if (!moduleSpecifier) {
        continue;
      }
      const resolved = resolveImportedDecorator(
        moduleSpecifier,
        requestedName,
        id,
        visitedModules,
        resolutionCache,
      );
      if (resolved) {
        return resolved;
      }
      continue;
    }

    if (!ts.isNamedExports(statement.exportClause)) {
      continue;
    }

    for (const element of statement.exportClause.elements) {
      if (element.name.text !== requestedName) {
        continue;
      }
      const resolved = resolveNamedExportElement(
        element,
        moduleSpecifier,
        fileImports,
        id,
        visitedModules,
        resolutionCache,
      );
      if (resolved) {
        return resolved;
      }
    }
  }

  return undefined;
}

function resolveNamedExportElement(
  element: ts.ExportSpecifier,
  moduleSpecifier: string | undefined,
  fileImports: Map<string, ImportInfo>,
  id: string,
  visitedModules: Set<string>,
  resolutionCache: DecoratorResolutionCache,
): AlloyDecoratorName | undefined {
  const sourceName = element.propertyName?.text ?? element.name.text;

  if (moduleSpecifier) {
    return resolveImportedDecorator(
      moduleSpecifier,
      sourceName,
      id,
      visitedModules,
      resolutionCache,
    );
  }

  const importInfo = fileImports.get(sourceName);
  if (!importInfo || importInfo.isTypeOnly) {
    return undefined;
  }
  return resolveImportedDecorator(
    importInfo.path,
    importInfo.originalName ?? sourceName,
    id,
    visitedModules,
    resolutionCache,
  );
}

function isAlloyDecoratorName(name: string): name is AlloyDecoratorName {
  return name === "Injectable" || name === "Singleton";
}

function collectReferencedImports(
  metadata: ReturnType<typeof extractServiceMetadata>,
  fileImports: Map<string, ImportInfo>,
) {
  const referenced: {
    name: string;
    path: string;
    originalName?: string;
    isTypeOnly?: boolean;
  }[] = [];
  const seen = new Set<string>();
  for (const dep of metadata.dependencies) {
    for (const ident of dep.referencedIdentifiers) {
      if (seen.has(ident)) {
        continue;
      }
      seen.add(ident);
      const importInfo = fileImports.get(ident);
      if (!importInfo) {
        continue;
      }
      referenced.push({
        name: ident,
        path: importInfo.path,
        originalName: importInfo.originalName,
        isTypeOnly: importInfo.isTypeOnly,
      });
    }
  }
  return referenced;
}

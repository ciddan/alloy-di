import { createClassKey } from "./utils";
import path from "path";
import ts from "typescript";

const RESOLVED_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
] as const;

export function processLazyCall(
  node: ts.CallExpression,
  fileId: string,
  sourceFile: ts.SourceFile,
  localLazyRefs: Set<string>,
) {
  if (node.expression.getText(sourceFile) !== "Lazy") {
    return;
  }
  const classKeys = resolveLazyTarget(node, fileId);
  if (!classKeys) {
    return;
  }
  for (const key of classKeys) {
    localLazyRefs.add(key);
  }
}

function resolveLazyTarget(
  node: ts.CallExpression,
  fileId: string,
): string[] | undefined {
  const factory = getLazyFactory(node.arguments[0]);
  if (!factory) {
    return undefined;
  }
  const body = getReturnedExpression(factory);
  if (!body) {
    return undefined;
  }
  const importInfo = extractImportInfo(body);
  const exportName = importInfo?.exportName;
  if (!importInfo || !exportName) {
    return undefined;
  }
  const resolvedPaths = resolveModuleSpecifierCandidates(
    fileId,
    importInfo.specifier,
  );
  if (!resolvedPaths.length) {
    return undefined;
  }
  return resolvedPaths.map((candidate) =>
    createClassKey(candidate, exportName),
  );
}

function getLazyFactory(
  arg: ts.Expression | undefined,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (!arg) {
    return undefined;
  }
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    return arg;
  }
  return undefined;
}

function getReturnedExpression(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | undefined {
  if (ts.isBlock(fn.body)) {
    for (const statement of fn.body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        return statement.expression;
      }
    }
    return undefined;
  }
  return fn.body;
}

function extractImportInfo(
  expr: ts.Expression,
): { specifier: string; exportName?: string } | undefined {
  if (!ts.isCallExpression(expr)) {
    return undefined;
  }
  if (isDynamicImport(expr)) {
    const spec = getImportSpecifier(expr.arguments[0]);
    return spec ? { specifier: spec } : undefined;
  }
  if (!ts.isPropertyAccessExpression(expr.expression)) {
    return undefined;
  }
  if (expr.expression.name.text !== "then") {
    return undefined;
  }
  const importCall = expr.expression.expression;
  if (!ts.isCallExpression(importCall) || !isDynamicImport(importCall)) {
    return undefined;
  }
  const spec = getImportSpecifier(importCall.arguments[0]);
  if (!spec) {
    return undefined;
  }
  const callback = expr.arguments[0];
  const exportName = callback ? extractExportName(callback) : undefined;
  return { specifier: spec, exportName };
}

function isDynamicImport(node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function getImportSpecifier(
  node: ts.Expression | undefined,
): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function extractExportName(callback: ts.Expression): string | undefined {
  if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
    const body = getReturnedExpression(callback);
    return body ? extractExportNameFromExpression(body) : undefined;
  }
  return extractExportNameFromExpression(callback);
}

function extractExportNameFromExpression(
  expr: ts.Expression,
): string | undefined {
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isNewExpression(expr) && expr.expression) {
    return extractExportNameFromExpression(expr.expression as ts.Expression);
  }
  return undefined;
}

function resolveModuleSpecifierCandidates(
  fromId: string,
  specifier: string,
): string[] {
  if (!specifier.startsWith(".")) {
    return [];
  }
  const baseDir = path.dirname(fromId);
  const resolvedBase = path.resolve(baseDir, specifier);
  if (path.extname(resolvedBase)) {
    return [resolvedBase];
  }
  const fileCandidates = RESOLVED_EXTENSIONS.map((ext) => resolvedBase + ext);
  const indexCandidates = RESOLVED_EXTENSIONS.map((ext) =>
    path.join(resolvedBase, `index${ext}`),
  );
  return [...fileCandidates, ...indexCandidates];
}

export const __lazyInternals = {
  resolveLazyTarget,
  getReturnedExpression,
  extractImportInfo,
  getImportSpecifier,
  extractExportName,
  extractExportNameFromExpression,
  resolveModuleSpecifierCandidates,
};

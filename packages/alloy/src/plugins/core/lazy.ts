import { createClassKey } from "./utils";
import path from "path";
import ts from "typescript";
import type { ManifestLazyDependency } from "./types";

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
  if (!isLazyCall(node, sourceFile)) {
    return;
  }
  const parsed = resolveLazyDependency(node, fileId);
  if (!parsed) {
    return;
  }
  for (const key of parsed.classKeys) {
    localLazyRefs.add(key);
  }
}

export interface ParsedLazyDependency extends ManifestLazyDependency {
  specifier: string;
  classKeys: string[];
}

export function parseLazyDependencyExpression(
  expression: string,
  fileId: string,
): ParsedLazyDependency | undefined {
  const sourceFile = ts.createSourceFile(
    fileId,
    `const __alloyLazy = (${expression});`,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) {
    return undefined;
  }
  const declaration = statement.declarationList.declarations[0];
  const initializer = declaration?.initializer;
  const call = initializer ? unwrapExpression(initializer) : undefined;
  if (!call || !ts.isCallExpression(call)) {
    return undefined;
  }
  return resolveLazyDependency(call, fileId);
}

function resolveLazyDependency(
  node: ts.CallExpression,
  fileId: string,
): ParsedLazyDependency | undefined {
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
  const retry = extractRetryOptions(node.arguments[1]);
  const resolvedPaths = resolveModuleSpecifierCandidates(
    fileId,
    importInfo.specifier,
  );
  if (!resolvedPaths.length) {
    return undefined;
  }
  return {
    specifier: importInfo.specifier,
    exportName,
    retry,
    importPath: importInfo.specifier,
    classKeys: resolvedPaths.map((candidate) =>
      createClassKey(candidate, exportName),
    ),
  };
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

function extractRetryOptions(
  expr: ts.Expression | undefined,
): ManifestLazyDependency["retry"] | undefined {
  if (!expr || !ts.isObjectLiteralExpression(expr)) {
    return undefined;
  }

  let retries: number | undefined;
  let backoffMs: number | undefined;
  let factor: number | undefined;

  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      continue;
    }
    const value = extractNumberLiteral(prop.initializer);
    if (typeof value !== "number") {
      continue;
    }
    if (prop.name.text === "retries") {
      retries = value;
    } else if (prop.name.text === "backoffMs") {
      backoffMs = value;
    } else if (prop.name.text === "factor") {
      factor = value;
    }
  }

  if (typeof retries !== "number") {
    return undefined;
  }

  return {
    retries,
    ...(typeof backoffMs === "number" ? { backoffMs } : {}),
    ...(typeof factor === "number" ? { factor } : {}),
  };
}

function extractNumberLiteral(expr: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(expr)) {
    return Number(expr.text);
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return -Number(expr.operand.text);
  }
  return undefined;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isTypeAssertionExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return unwrapExpression(expr.expression);
  }
  return expr;
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

function isLazyCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const text = node.expression.getText(sourceFile);
  return text === "Lazy" || text.endsWith(".Lazy");
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

export function resolveModuleSpecifierCandidates(
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
  resolveLazyDependency,
  extractRetryOptions,
  extractNumberLiteral,
  unwrapExpression,
  getReturnedExpression,
  extractImportInfo,
  getImportSpecifier,
  extractExportName,
  extractExportNameFromExpression,
  resolveModuleSpecifierCandidates,
};

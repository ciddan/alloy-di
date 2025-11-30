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
  const exprText = node.expression.getText(sourceFile);
  if (exprText !== "Lazy") {
    return;
  }
  const classKeys = resolveLazyTarget(node, fileId);
  if (classKeys) {
    for (const key of classKeys) {
      localLazyRefs.add(key);
    }
  }
}

function resolveLazyTarget(
  node: ts.CallExpression,
  fileId: string,
): string[] | undefined {
  if (node.arguments.length === 0) {
    return undefined;
  }
  const factory = node.arguments[0];
  if (!(ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
    return undefined;
  }
  const body = getReturnedExpression(factory);
  if (!body) {
    return undefined;
  }
  const importInfo = extractImportInfo(body);
  if (!importInfo) {
    return undefined;
  }
  const resolvedPaths = resolveModuleSpecifierCandidates(
    fileId,
    importInfo.specifier,
  );
  if (!resolvedPaths.length) {
    return undefined;
  }
  const exportName = importInfo.exportName;
  if (!exportName) {
    return undefined;
  }
  return resolvedPaths.map((candidate) =>
    createClassKey(candidate, exportName),
  );
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
  if (ts.isCallExpression(expr)) {
    if (isDynamicImport(expr)) {
      const spec = getImportSpecifier(expr.arguments[0]);
      if (!spec) {
        return undefined;
      }
      return { specifier: spec, exportName: undefined };
    }
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === "then"
    ) {
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
  }
  return undefined;
}

function isDynamicImport(node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function getImportSpecifier(
  node: ts.Expression | undefined,
): string | undefined {
  if (!node) {
    return undefined;
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  return undefined;
}

function extractExportName(callback: ts.Expression): string | undefined {
  if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
    const body = getReturnedExpression(callback);
    if (!body) {
      return undefined;
    }
    return extractExportNameFromExpression(body);
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
  const candidates: string[] = [];
  const hasExtension = Boolean(path.extname(resolvedBase));
  if (hasExtension) {
    candidates.push(resolvedBase);
  } else {
    for (const ext of RESOLVED_EXTENSIONS) {
      candidates.push(resolvedBase + ext);
    }
    for (const ext of RESOLVED_EXTENSIONS) {
      candidates.push(path.join(resolvedBase, "index" + ext));
    }
  }
  return candidates;
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

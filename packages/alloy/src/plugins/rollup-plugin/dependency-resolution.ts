import ts from "typescript";
import type { DependencyDescriptor, DiscoveredMeta } from "../core/types";

/**
 * Return the imports referenced by a dependency expression, filtered to the
 * identifiers the dependency actually uses.
 */
export function getDependencyImports(
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

/**
 * Parse a dependency expression and return the referenced symbol name, peeling
 * away `as`/parenthesized/non-null/type-assertion wrappers.
 */
export function getDependencyReferenceName(
  expression: string,
): string | undefined {
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

/**
 * Resolve the class name a (non-lazy) dependency refers to, if it matches a
 * known discovered service. Checks imported original names, then the parsed
 * reference name, then any referenced identifier.
 */
export function resolveClassDependencyName(
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

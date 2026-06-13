import ts from "typescript";

/** Check if a node has the 'export' modifier */
function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
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
 * @param fileSources - Map of scanned source files to their text (from the discovery store).
 * @returns Set of exported symbol names found in the barrel file
 */
export function parseExportedNames(
  fileSources: Map<string, string> | undefined,
): Set<string> {
  if (!fileSources) {
    return new Set<string>();
  }
  // Find barrel entry point - prefer /src/index.ts, fallback to /index.ts
  const barrelEntry =
    [...fileSources.keys()].find((p) =>
      /\/src\/index\.(tsx?|mts|cts)$/i.test(p),
    ) ?? [...fileSources.keys()].find((p) => /\/index\.(tsx?|ts)$/i.test(p));
  const sourceText = barrelEntry ? fileSources.get(barrelEntry) : undefined;
  if (!barrelEntry || !sourceText) {
    return new Set<string>();
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
  return names;
}

import ts, { SyntaxKind } from "typescript";
import { extractServiceMetadata } from "./decorators";
import { processLazyCall } from "./lazy";
import { createClassKey, createSymbolKey } from "./utils";
import type { DiscoveredMeta } from "./types";

export interface ScanResult {
  metas: DiscoveredMeta[];
  lazyClassKeys: Set<string>;
}

interface ImportInfo {
  path: string;
  originalName?: string;
  isTypeOnly?: boolean;
}

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

export function scanSource(code: string, id: string): ScanResult {
  const sourceFile = ts.createSourceFile(
    id,
    code,
    ts.ScriptTarget.ESNext,
    true,
  );
  const discovered = new Map<string, DiscoveredMeta>();
  const lazyRefs = new Set<string>();
  const fileImports = collectFileImports(sourceFile);

  const visit = (node: ts.Node) => {
    if (!ts.isClassDeclaration(node) || !node.name) {
      if (ts.isCallExpression(node)) {
        processLazyCall(node, id, sourceFile, lazyRefs);
      }
      ts.forEachChild(node, visit);
      return;
    }

    const decorators = ts.getDecorators ? ts.getDecorators(node) : [];
    const targetDecorator = decorators?.find((d) => {
      if (!ts.isCallExpression(d.expression)) {
        return false;
      }
      const name = d.expression.expression.getText(sourceFile);
      return name.endsWith("Injectable") || name.endsWith("Singleton");
    });
    if (!targetDecorator || !ts.isCallExpression(targetDecorator.expression)) {
      ts.forEachChild(node, visit);
      return;
    }

    const decoratorName =
      targetDecorator.expression.expression.getText(sourceFile);
    const className = node.name.getText(sourceFile);
    const callExpression = targetDecorator.expression;

    const metadata = extractServiceMetadata(
      decoratorName,
      callExpression,
      sourceFile,
    );

    const referencedImports: {
      name: string;
      path: string;
      originalName?: string;
      isTypeOnly?: boolean;
    }[] = [];
    const seenIdentifiers = new Set<string>();

    for (const dep of metadata.dependencies) {
      for (const ident of dep.referencedIdentifiers) {
        if (seenIdentifiers.has(ident)) {
          continue;
        }
        seenIdentifiers.add(ident);

        const importInfo = fileImports.get(ident);
        if (importInfo) {
          referencedImports.push({
            name: ident,
            path: importInfo.path,
            originalName: importInfo.originalName,
            isTypeOnly: importInfo.isTypeOnly,
          });
        }
      }
    }

    const classKey = createClassKey(id, className);
    discovered.set(classKey, {
      className,
      filePath: id,
      identifierKey: createSymbolKey(id, className),
      metadata,
      referencedImports,
    });
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return { metas: Array.from(discovered.values()), lazyClassKeys: lazyRefs };
}

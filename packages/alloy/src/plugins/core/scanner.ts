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
    if (ts.isClassDeclaration(node)) {
      handleClassDeclaration(node, {
        id,
        sourceFile,
        fileImports,
        discovered,
      });
    } else if (ts.isCallExpression(node)) {
      processLazyCall(node, id, sourceFile, lazyRefs);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return { metas: Array.from(discovered.values()), lazyClassKeys: lazyRefs };
}

interface ClassVisitContext {
  id: string;
  sourceFile: ts.SourceFile;
  fileImports: Map<string, ImportInfo>;
  discovered: Map<string, DiscoveredMeta>;
}

function handleClassDeclaration(
  node: ts.ClassDeclaration,
  context: ClassVisitContext,
) {
  if (!node.name) {
    return;
  }
  const decoratorCall = findServiceDecorator(node, context.sourceFile);
  if (!decoratorCall) {
    return;
  }
  const decoratorName = decoratorCall.expression.getText(context.sourceFile);
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
): ts.CallExpression | undefined {
  const decorators = ts.getDecorators ? ts.getDecorators(node) : undefined;
  if (!decorators?.length) {
    return undefined;
  }
  for (const decorator of decorators) {
    if (!ts.isCallExpression(decorator.expression)) {
      continue;
    }
    const name = decorator.expression.expression.getText(sourceFile);
    if (name.endsWith("Injectable") || name.endsWith("Singleton")) {
      return decorator.expression;
    }
  }
  return undefined;
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

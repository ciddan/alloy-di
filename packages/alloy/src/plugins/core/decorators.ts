import ts from "typescript";
import { ServiceScope } from "../../lib/scope";
import type { DependencyDescriptor, ServiceMetadata } from "./types";

function extractRefs(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  identifiers: Set<string>,
) {
  if (ts.isPropertyAssignment(node)) {
    extractRefs(node.initializer, sourceFile, identifiers);
    if (ts.isComputedPropertyName(node.name)) {
      extractRefs(node.name.expression, sourceFile, identifiers);
    }
    return;
  }

  if (ts.isIdentifier(node)) {
    identifiers.add(node.text);
    return;
  }

  if (ts.isCallExpression(node)) {
    const name = node.expression.getText(sourceFile);
    if (name === "Lazy" || name.endsWith(".Lazy")) {
      node.arguments.forEach((arg) =>
        extractRefs(arg, sourceFile, identifiers),
      );
      return;
    }
  }

  ts.forEachChild(node, (n) => extractRefs(n, sourceFile, identifiers));
}

function createDependencyDescriptor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): DependencyDescriptor {
  const expression = node.getText(sourceFile);
  const referencedIdentifiers = new Set<string>();
  let isLazy = false;

  if (ts.isCallExpression(node)) {
    const callName = node.expression.getText(sourceFile);
    if (callName === "Lazy" || callName.endsWith(".Lazy")) {
      isLazy = true;
    }
  }

  extractRefs(node, sourceFile, referencedIdentifiers);

  return {
    expression,
    referencedIdentifiers: Array.from(referencedIdentifiers),
    isLazy,
  };
}

function parseDependencies(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): DependencyDescriptor[] {
  if (ts.isArrowFunction(node)) {
    return parseDependencies(node.body, sourceFile);
  }

  if (ts.isParenthesizedExpression(node)) {
    return parseDependencies(node.expression, sourceFile);
  }

  if (ts.isCallExpression(node)) {
    return node.arguments.map((arg) =>
      createDependencyDescriptor(arg, sourceFile),
    );
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((arg) =>
      createDependencyDescriptor(arg, sourceFile),
    );
  }

  return [];
}

export function extractServiceMetadata(
  decoratorName: string,
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ServiceMetadata {
  let scope: ServiceScope = ServiceScope.TRANSIENT;
  let dependencies: DependencyDescriptor[] = [];

  if (decoratorName.endsWith("Singleton")) {
    scope = ServiceScope.SINGLETON;
  }

  const args = callExpression.arguments;
  if (args.length === 0) {
    return { scope, dependencies };
  }

  const firstArg = args[0];

  if (ts.isObjectLiteralExpression(firstArg)) {
    for (const prop of firstArg.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        if (prop.name.text === "scope") {
          if (ts.isStringLiteral(prop.initializer)) {
            const val = prop.initializer.text;
            if (val === "singleton") {
              scope = ServiceScope.SINGLETON;
            } else if (val === "transient") {
              scope = ServiceScope.TRANSIENT;
            }
          }
        } else if (prop.name.text === "dependencies") {
          dependencies = parseDependencies(prop.initializer, sourceFile);
        }
      }
    }
    // Override scope if Singleton decorator was used
    if (decoratorName.endsWith("Singleton")) {
      scope = ServiceScope.SINGLETON;
    }
    return { scope, dependencies };
  }

  let depsNode: ts.Node | undefined;

  if (ts.isStringLiteralLike(firstArg)) {
    if (firstArg.text === "singleton") {
      scope = ServiceScope.SINGLETON;
    }
  } else {
    depsNode = firstArg;
  }

  if (args.length > 1) {
    const secondArg = args[1];
    if (ts.isStringLiteralLike(secondArg)) {
      if (secondArg.text === "singleton") {
        scope = ServiceScope.SINGLETON;
      }
    }
  }

  if (depsNode) {
    dependencies = parseDependencies(depsNode, sourceFile);
  }

  return { scope, dependencies };
}

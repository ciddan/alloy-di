import ts from "typescript";
import { describe, expect, it } from "vitest";
import { processLazyCall, __lazyInternals } from "./lazy";

const {
  getReturnedExpression,
  extractImportInfo,
  getImportSpecifier,
  extractExportName,
  extractExportNameFromExpression,
  resolveModuleSpecifierCandidates,
} = __lazyInternals;

function createSourceFile(code: string, fileName = "/src/test.ts") {
  return ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
}

function findNode<T extends ts.Node>(
  sourceFile: ts.SourceFile,
  predicate: (node: ts.Node) => node is T,
): T {
  let target: T | undefined;
  const visit = (node: ts.Node) => {
    if (target) {
      return;
    }
    if (predicate(node)) {
      target = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  if (!target) {
    throw new Error("Node not found for test");
  }
  return target;
}

function getLazyCall(code: string, fileName = "/src/entry.ts") {
  const sourceFile = createSourceFile(code, fileName);
  const call = findNode(
    sourceFile,
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "Lazy",
  );
  return { call, sourceFile };
}

function collectLazyRefs(code: string, fileName = "/src/entry.ts") {
  const { call, sourceFile } = getLazyCall(code, fileName);
  const refs = new Set<string>();
  processLazyCall(call, fileName, sourceFile, refs);
  return refs;
}

function getCallExpressionFromCode(
  code: string,
  predicate?: (node: ts.CallExpression, sourceFile: ts.SourceFile) => boolean,
) {
  const sourceFile = createSourceFile(code);
  const call = findNode(sourceFile, (node): node is ts.CallExpression => {
    if (!ts.isCallExpression(node)) {
      return false;
    }
    return predicate ? predicate(node, sourceFile) : true;
  });
  return { call, sourceFile };
}

describe("processLazyCall", () => {
  it("ignores Lazy calls without arguments", () => {
    const refs = collectLazyRefs("Lazy();");
    expect(refs.size).toBe(0);
  });
  it("ignores Lazy calls whose argument is not a factory", () => {
    const refs = collectLazyRefs("Lazy(123 as any);");
    expect(refs.size).toBe(0);
  });
  it("collects keys for block-bodied Lazy imports", () => {
    const refs = collectLazyRefs(
      "\n      Lazy(() => {\n        return import('./services/foo').then((m) => m.Service);\n      });\n    ",
    );
    expect(
      Array.from(refs).some((key) => key.endsWith("/services/foo.ts::Service")),
    ).toBe(true);
  });
  it("collects keys for Lazy imports with explicit extensions", () => {
    const refs = collectLazyRefs(
      "Lazy(() => import('./services/bar.ts').then((m) => m.Service));",
    );
    expect(refs.has("/src/services/bar.ts::Service")).toBe(true);
  });
  it("ignores Lazy factories without return statements", () => {
    const refs = collectLazyRefs("Lazy(() => { const value = 1; });");
    expect(refs.size).toBe(0);
  });
  it("ignores Lazy imports that are not relative to the caller", () => {
    const refs = collectLazyRefs(
      "Lazy(() => import('pkg').then((m) => m.Service));",
    );
    expect(refs.size).toBe(0);
  });
  it("ignores Lazy imports whose exports cannot be determined", () => {
    const refs = collectLazyRefs(
      "Lazy(() => import('./services/foo').then());",
    );
    expect(refs.size).toBe(0);
  });
});

describe("__lazyInternals", () => {
  it("returns the inner expression from a block-bodied factory", () => {
    const sourceFile = createSourceFile(
      "\n      const factory = () => {\n        return import('./dep');\n      };\n    ",
    );
    const arrow = findNode(sourceFile, (node): node is ts.ArrowFunction =>
      ts.isArrowFunction(node),
    );
    const result = getReturnedExpression(arrow);
    expect(result && ts.isCallExpression(result)).toBe(true);
  });
  it("returns undefined when a block-bodied factory never returns", () => {
    const sourceFile = createSourceFile(
      "\n      const factory = () => {\n        const value = 1;\n      };\n    ",
    );
    const arrow = findNode(sourceFile, (node): node is ts.ArrowFunction =>
      ts.isArrowFunction(node),
    );
    expect(getReturnedExpression(arrow)).toBeUndefined();
  });
  it("extracts specifiers from direct dynamic imports", () => {
    const { call } = getCallExpressionFromCode("import('./foo');");
    const info = extractImportInfo(call);
    expect(info).toEqual({ specifier: "./foo", exportName: undefined });
  });
  it("returns undefined when the expression is not a call", () => {
    const sourceFile = createSourceFile("identifier;");
    const identifier = findNode(sourceFile, (node): node is ts.Identifier =>
      ts.isIdentifier(node),
    );
    expect(extractImportInfo(identifier)).toBeUndefined();
  });
  it("returns undefined when .then is not chained from a dynamic import", () => {
    const { call } = getCallExpressionFromCode(
      "promise.then((m) => m.Service);",
      (node, sourceFile) =>
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText(sourceFile) === "then",
    );
    expect(extractImportInfo(call)).toBeUndefined();
  });
  it("handles .then chains even without callbacks", () => {
    const { call } = getCallExpressionFromCode(
      "import('./foo').then();",
      (node, sourceFile) =>
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText(sourceFile) === "then",
    );
    const info = extractImportInfo(call);
    expect(info).toEqual({ specifier: "./foo", exportName: undefined });
  });
  it("returns undefined import specifiers when the argument is missing", () => {
    expect(getImportSpecifier(undefined)).toBeUndefined();
  });
  it("returns undefined import specifiers when the argument is not a string", () => {
    expect(
      getImportSpecifier(ts.factory.createIdentifier("mod")),
    ).toBeUndefined();
  });
  it("extracts identifiers from callbacks without wrappers", () => {
    expect(extractExportName(ts.factory.createIdentifier("Service"))).toBe(
      "Service",
    );
  });
  it("returns undefined when callback functions do not return", () => {
    const arrow = ts.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createBlock([], true),
    );
    expect(extractExportName(arrow)).toBeUndefined();
  });
  it("recursively extracts export names from new expressions", () => {
    const expr = ts.factory.createNewExpression(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier("m"),
        "Service",
      ),
      undefined,
      [],
    );
    expect(extractExportNameFromExpression(expr)).toBe("Service");
  });
  it("returns undefined for unknown export expressions", () => {
    const expr = ts.factory.createNumericLiteral(1);
    expect(extractExportNameFromExpression(expr)).toBeUndefined();
  });
  it("returns no candidates for non-relative specifiers", () => {
    expect(resolveModuleSpecifierCandidates("/src/file.ts", "pkg")).toEqual([]);
  });
  it("returns only the provided path when an extension exists", () => {
    expect(
      resolveModuleSpecifierCandidates("/src/file.ts", "./service.ts"),
    ).toEqual(["/src/service.ts"]);
  });
  it("generates extension and index candidates for bare specifiers", () => {
    const candidates = resolveModuleSpecifierCandidates(
      "/src/file.ts",
      "./svc",
    );
    expect(candidates).toContain("/src/svc.ts");
    expect(candidates).toContain("/src/svc/index.ts");
  });
});

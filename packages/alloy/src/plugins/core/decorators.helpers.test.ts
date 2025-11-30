import ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractServiceMetadata } from "./decorators";
import { ServiceScope } from "../../lib/scope";

function getCallExpression(code: string) {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  let target: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      target = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  if (!target) {
    throw new Error("No call expression found in test source");
  }
  return { call: target, sourceFile };
}

describe("extractServiceMetadata", () => {
  it("extracts dependencies from object literal", () => {
    const { call, sourceFile } = getCallExpression(
      "Injectable({ dependencies: () => [Dep] });",
    );
    const meta = extractServiceMetadata("Injectable", call, sourceFile);
    expect(meta.scope).toBe(ServiceScope.TRANSIENT);
    expect(meta.dependencies).toHaveLength(1);
    expect(meta.dependencies[0].expression).toBe("Dep");
  });

  it("forces singleton scope for Singleton decorator with object literal", () => {
    const { call, sourceFile } = getCallExpression(
      "Singleton({ dependencies: () => [] });",
    );
    const meta = extractServiceMetadata("Singleton", call, sourceFile);
    expect(meta.scope).toBe(ServiceScope.SINGLETON);
  });

  it("parses scope string shorthand", () => {
    const { call, sourceFile } = getCallExpression("Injectable('singleton');");
    const meta = extractServiceMetadata("Injectable", call, sourceFile);
    expect(meta.scope).toBe(ServiceScope.SINGLETON);
  });

  it("handles dependencies and scope passed positionally", () => {
    const { call, sourceFile } = getCallExpression(
      "Injectable(() => [Dep], 'singleton');",
    );
    const meta = extractServiceMetadata("Injectable", call, sourceFile);
    expect(meta.scope).toBe(ServiceScope.SINGLETON);
    expect(meta.dependencies).toHaveLength(1);
  });

  it("forces singleton scope for Singleton decorator with shorthand", () => {
    const { call, sourceFile } = getCallExpression("Singleton('ignored');");
    const meta = extractServiceMetadata("Singleton", call, sourceFile);
    expect(meta.scope).toBe(ServiceScope.SINGLETON);
  });

  it("parses function dependency list", () => {
    const { call, sourceFile } = getCallExpression("Injectable(() => [Dep]);");
    const meta = extractServiceMetadata("Injectable", call, sourceFile);
    expect(meta.dependencies[0].expression).toBe("Dep");
  });
});

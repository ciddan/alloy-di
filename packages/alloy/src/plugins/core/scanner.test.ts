import { describe, it, expect } from "vitest";
import { scanSource } from "./scanner";

const runScan = (code: string) =>
  scanSource(code, "/src/example.ts").metas[0]?.referencedImports ?? [];

describe("scanner type-only import handling", () => {
  it("flags default type-only imports referenced in metadata", () => {
    const code = `
      import type Foo from "./foo";
      import { Injectable, deps } from "alloy-di/runtime";

      @Injectable(deps(Foo))
      export class Example {}
    `;
    const imports = runScan(code);
    const fooImport = imports.find((entry) => entry.name === "Foo");
    expect(fooImport).toBeDefined();
    expect(fooImport).toMatchObject({
      path: "./foo",
      originalName: "default",
      isTypeOnly: true,
    });
  });

  it("differentiates between type-only and runtime named imports", () => {
    const code = `
      import { type Foo, Bar } from "./foo";
      import { Injectable, deps } from "alloy-di/runtime";

      @Injectable(deps(Foo, Bar))
      export class Example {}
    `;
    const imports = runScan(code);
    const fooImport = imports.find((entry) => entry.name === "Foo");
    const barImport = imports.find((entry) => entry.name === "Bar");

    expect(fooImport).toMatchObject({
      path: "./foo",
      originalName: "Foo",
      isTypeOnly: true,
    });
    expect(barImport).toMatchObject({
      path: "./foo",
      originalName: "Bar",
      isTypeOnly: false,
    });
  });

  it("marks namespace imports as type-only when prefixed with `import type *`", () => {
    const code = `
      import type * as FooNS from "./foo";
      import { Injectable, deps } from "alloy-di/runtime";

      @Injectable(deps(FooNS.SomeCtor))
      export class Example {}
    `;
    const imports = runScan(code);
    const nsImport = imports.find((entry) => entry.name === "FooNS");
    expect(nsImport).toMatchObject({
      path: "./foo",
      originalName: "*",
      isTypeOnly: true,
    });
  });
});

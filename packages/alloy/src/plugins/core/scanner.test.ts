import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServiceScope } from "../../lib/scope";
import { scanSource } from "./scanner";

const runImportsScan = (code: string) =>
  scanSource(code, "/src/example.ts").metas[0]?.referencedImports ?? [];

const runMetaScan = (code: string, fileName = "/src/example.ts") =>
  scanSource(code, fileName).metas;

describe("scanner type-only import handling", () => {
  it("flags default type-only imports referenced in metadata", () => {
    const code = `
      import type Foo from "./foo";
      import { Injectable, deps } from "alloy-di/runtime";

      @Injectable(deps(Foo))
      export class Example {}
    `;
    const imports = runImportsScan(code);
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
    const imports = runImportsScan(code);
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
    const imports = runImportsScan(code);
    const nsImport = imports.find((entry) => entry.name === "FooNS");
    expect(nsImport).toMatchObject({
      path: "./foo",
      originalName: "*",
      isTypeOnly: true,
    });
  });
});

describe("scanner decorator provenance", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("discovers Alloy decorators imported with aliases", () => {
    const metas = runMetaScan(`
      import { Injectable as Inj } from "alloy-di/runtime";

      @Inj()
      export class Example {}
    `);

    expect(metas).toHaveLength(1);
    expect(metas[0]?.className).toBe("Example");
  });

  it("discovers Alloy decorators imported via namespace", () => {
    const metas = runMetaScan(`
      import * as Alloy from "alloy-di/runtime";

      @Alloy.Singleton()
      export class Example {}
    `);

    expect(metas).toHaveLength(1);
    expect(metas[0]?.metadata.scope).toBe(ServiceScope.SINGLETON);
  });

  it("ignores unrelated decorators that happen to end with Injectable", () => {
    const metas = runMetaScan(`
      import { Injectable } from "@angular/core";

      @Injectable()
      export class Example {}
    `);

    expect(metas).toHaveLength(0);
  });

  it("resolves Alloy decorators re-exported through a local module", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const decoratorsPath = path.join(tmpDir, "decorators.ts");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.writeFileSync(
      decoratorsPath,
      'export { Injectable as Decorator } from "alloy-di/runtime";\n',
    );

    const serviceCode = `
      import { Decorator } from "./decorators";

      @Decorator()
      export class Example {}
    `;

    const metas = runMetaScan(serviceCode, servicePath);
    expect(metas).toHaveLength(1);
    expect(metas[0]?.className).toBe("Example");
  });
});

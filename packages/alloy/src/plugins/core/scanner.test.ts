import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceScope } from "../../lib/scope";
import { __scannerInternals, scanSource } from "./scanner";

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

describe("scanner parse pre-filter (issue #22)", () => {
  const { mayContainDiscoverableSyntax } = __scannerInternals;

  it("rejects files without decorator or Lazy syntax", () => {
    expect(
      mayContainDiscoverableSyntax(
        `import { helper } from "./helper";\nexport const value = helper(1);\n`,
      ),
    ).toBe(false);
  });

  it("accepts files containing Lazy references", () => {
    expect(
      mayContainDiscoverableSyntax(
        `import { Lazy } from "alloy-di/runtime";\nexport const dep = Lazy(() => import("./heavy"));\n`,
      ),
    ).toBe(true);
  });

  it("accepts files containing asFactory provider references", () => {
    expect(
      mayContainDiscoverableSyntax(
        `import { asFactory } from "alloy-di/runtime";\nexport default { factories: [asFactory(Token, () => 1, { lifecycle: "singleton" })] };\n`,
      ),
    ).toBe(true);
  });

  it("returns an empty result for filtered files", () => {
    const result = scanSource(`export const value = 1;\n`, "/src/plain.ts");
    expect(result.metas).toHaveLength(0);
    expect(result.lazyClassKeys.size).toBe(0);
    expect(result.factoryProviders).toHaveLength(0);
  });

  it("skips asFactory-only files when factory provider scanning is disabled", () => {
    const result = scanSource(
      `import { asFactory } from "alloy-di/runtime";\nasFactory(Token, () => 1);\n`,
      "/src/providers.ts",
      { factoryProviders: false },
    );

    expect(result.metas).toHaveLength(0);
    expect(result.lazyClassKeys.size).toBe(0);
    expect(result.factoryProviders).toHaveLength(0);
  });
});

describe("scanner factory provider discovery", () => {
  it("discovers token-bound factories imported from the runtime", () => {
    const result = scanSource(
      `
        import { asFactory, lifecycle } from "alloy-di/runtime";
        import { ApiClientToken } from "./tokens";

        export default {
          factories: [
            asFactory(ApiClientToken, () => ({}), {
              lifecycle: lifecycle.singleton(),
            }),
          ],
        };
      `,
      "/src/providers.ts",
    );

    expect(result.metas).toHaveLength(0);
    expect(result.factoryProviders).toEqual([
      {
        filePath: "/src/providers.ts",
        tokenExpression: "ApiClientToken",
        tokenLabel: "ApiClientToken",
        lifecycle: "singleton",
      },
    ]);
  });

  it("supports aliased and namespace asFactory imports", () => {
    const aliased = scanSource(
      `
        import { asFactory as makeFactory } from "alloy-di/runtime";
        makeFactory(RequestToken, () => ({}), { lifecycle: "request" });
      `,
      "/src/aliased-providers.ts",
    );
    const namespaced = scanSource(
      `
        import * as Alloy from "alloy-di/runtime";
        Alloy.asFactory(CacheToken, () => ({}), {
          lifecycle: Alloy.lifecycle.transient(),
        });
      `,
      "/src/namespaced-providers.ts",
    );

    expect(aliased.factoryProviders[0]).toMatchObject({
      tokenLabel: "RequestToken",
      lifecycle: "request",
    });
    expect(namespaced.factoryProviders[0]).toMatchObject({
      tokenLabel: "CacheToken",
      lifecycle: "transient",
    });
  });

  it("defaults unknown factory lifecycle expressions to singleton", () => {
    const result = scanSource(
      `
        import { asFactory } from "alloy-di/runtime";
        const selectedLifecycle = computeLifecycle();
        asFactory(DynamicToken, () => ({}), {
          lifecycle: selectedLifecycle,
        });
      `,
      "/src/dynamic-lifecycle-providers.ts",
    );

    expect(result.factoryProviders[0]).toMatchObject({
      tokenLabel: "DynamicToken",
      lifecycle: "singleton",
    });
  });

  it("ignores unrelated asFactory calls", () => {
    const result = scanSource(
      `
        import { asFactory } from "some-other-di";
        asFactory(Token, () => ({}), { lifecycle: "singleton" });
      `,
      "/src/unrelated.ts",
    );

    expect(result.factoryProviders).toHaveLength(0);
  });
});

describe("scanner bare decorator detection (issue #21)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns on bare @Injectable and does not register the class", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = `
      import { Injectable } from "alloy-di/runtime";

      @Injectable
      export class Oops {}
    `;
    const metas = runMetaScan(code);
    expect(metas).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /\[alloy\] \/src\/example\.ts:4 applies @Injectable without calling it — use @Injectable\(\)/,
    );
  });

  it("warns on bare namespace-form @Alloy.Singleton", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = `
      import * as Alloy from "alloy-di/runtime";

      @Alloy.Singleton
      export class Oops {}
    `;
    const metas = runMetaScan(code);
    expect(metas).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain(
      "applies @Alloy.Singleton without calling it — use @Alloy.Singleton()",
    );
  });

  it("suggests the local alias for aliased bare imports", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = `
      import { Injectable as Inj } from "alloy-di/runtime";

      @Inj
      export class Oops {}
    `;
    const metas = runMetaScan(code);
    expect(metas).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain(
      "applies @Inj without calling it — use @Inj()",
    );
  });

  it("does not warn for unrelated bare decorators", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = `
      import { observable } from "some-library";

      @observable
      export class Plain {}
    `;
    const metas = runMetaScan(code);
    expect(metas).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
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

  it("ignores non-service runtime decorators", () => {
    const metas = runMetaScan(`
      import { deps } from "alloy-di/runtime";

      @deps()
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

  it("resolves Alloy decorators through export-star barrels", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const decoratorsPath = path.join(tmpDir, "decorators.ts");
    const barrelPath = path.join(tmpDir, "barrel.ts");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.writeFileSync(
      decoratorsPath,
      'export { Singleton } from "alloy-di/runtime";\n',
    );
    fs.writeFileSync(barrelPath, 'export * from "./decorators";\n');

    const metas = runMetaScan(
      `
        import { Singleton } from "./barrel";

        @Singleton()
        export class Example {}
      `,
      servicePath,
    );

    expect(metas).toHaveLength(1);
    expect(metas[0]?.metadata.scope).toBe(ServiceScope.SINGLETON);
  });

  it("resolves Alloy decorators through local import-export indirection", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const decoratorsPath = path.join(tmpDir, "decorators.ts");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.writeFileSync(
      decoratorsPath,
      [
        'import { Injectable as BaseDecorator } from "alloy-di/runtime";',
        "export { BaseDecorator as Decorator };",
        "",
      ].join("\n"),
    );

    const metas = runMetaScan(
      `
        import { Decorator } from "./decorators";

        @Decorator()
        export class Example {}
      `,
      servicePath,
    );

    expect(metas).toHaveLength(1);
    expect(metas[0]?.className).toBe("Example");
  });

  it("ignores local re-exports backed by type-only imports", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const decoratorsPath = path.join(tmpDir, "decorators.ts");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.writeFileSync(
      decoratorsPath,
      [
        'import type { Injectable as BaseDecorator } from "alloy-di/runtime";',
        "export { BaseDecorator as Decorator };",
        "",
      ].join("\n"),
    );

    const metas = runMetaScan(
      `
        import { Decorator } from "./decorators";

        @Decorator()
        export class Example {}
      `,
      servicePath,
    );

    expect(metas).toHaveLength(0);
  });

  it("ignores namespace export barrels that do not expose named decorators", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const decoratorsPath = path.join(tmpDir, "decorators.ts");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.writeFileSync(
      decoratorsPath,
      'export * as AlloyDecorators from "alloy-di/runtime";\n',
    );

    const metas = runMetaScan(
      `
        import { Injectable } from "./decorators";

        @Injectable()
        export class Example {}
      `,
      servicePath,
    );

    expect(metas).toHaveLength(0);
  });

  it("ignores missing local decorator modules", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const servicePath = path.join(tmpDir, "service.ts");

    const metas = runMetaScan(
      `
        import { Decorator } from "./decorators";

        @Decorator()
        export class Example {}
      `,
      servicePath,
    );

    expect(metas).toHaveLength(0);
  });

  it("stops resolving cyclic local re-exports", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const firstPath = path.join(tmpDir, "first.ts");
    const secondPath = path.join(tmpDir, "second.ts");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.writeFileSync(firstPath, 'export { Decorator } from "./second";\n');
    fs.writeFileSync(secondPath, 'export { Decorator } from "./first";\n');

    const metas = runMetaScan(
      `
        import { Decorator } from "./first";

        @Decorator()
        export class Example {}
      `,
      servicePath,
    );

    expect(metas).toHaveLength(0);
  });

  it("ignores unreadable local decorator modules", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const decoratorsDir = path.join(tmpDir, "decorators");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.mkdirSync(decoratorsDir);

    const metas = runMetaScan(
      `
        import { Decorator } from "./decorators";

        @Decorator()
        export class Example {}
      `,
      servicePath,
    );

    expect(metas).toHaveLength(0);
  });

  it("caches repeated local decorator lookups within a scan", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-scanner-"));
    const decoratorsPath = path.join(tmpDir, "decorators.ts");
    const servicePath = path.join(tmpDir, "service.ts");

    fs.writeFileSync(
      decoratorsPath,
      'export { Injectable as Decorator } from "alloy-di/runtime";\n',
    );

    const readFileSyncSpy = vi.spyOn(fs, "readFileSync");

    try {
      const metas = runMetaScan(
        `
          import { Decorator } from "./decorators";

          @Decorator()
          export class First {}

          @Decorator()
          export class Second {}
        `,
        servicePath,
      );

      expect(metas).toHaveLength(2);
      expect(
        readFileSyncSpy.mock.calls.filter(
          ([candidate]) => candidate === decoratorsPath,
        ),
      ).toHaveLength(1);
    } finally {
      readFileSyncSpy.mockRestore();
    }
  });
});

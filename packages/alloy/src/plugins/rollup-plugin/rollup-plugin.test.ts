import { describe, it, expect } from "vitest";
import fs from "fs";
import { alloy } from "../../rollup";
import type { AlloyManifest } from "../core/types";

// Helper to simulate Rollup plugin lifecycle for the manifest plugin.
function runPlugin(
  files: Record<string, string>,
  outputOptions: { preserveModules?: boolean } = { preserveModules: false },
  pluginOptions: any = {},
) {
  const plugin = alloy(pluginOptions);
  // transform phase
  for (const [id, code] of Object.entries(files)) {
    if (plugin.transform) {
      plugin.transform(code, id);
    }
  }
  const emitted: { fileName: string; source: string }[] = [];
  const ctx = {
    emitFile(file: { type: "asset"; fileName: string; source: string }) {
      emitted.push({ fileName: file.fileName, source: file.source });
    },
  } as any;
  if (plugin.generateBundle) {
    plugin.generateBundle.call(ctx, outputOptions);
  }
  return emitted;
}

function readManifest(
  emitted: { fileName: string; source: string }[],
): AlloyManifest {
  const source = emitted.find((f) =>
    f.fileName.endsWith(".manifest.mjs"),
  )?.source;
  if (!source) {
    throw new Error("Manifest source not emitted");
  }
  const match = source.match(/export const manifest = ([\s\S]*);\n?$/);
  if (!match?.[1]) {
    throw new Error("Unable to parse manifest source");
  }
  return JSON.parse(match[1]) as AlloyManifest;
}

describe("manifest-plugin", () => {
  it("marks missing exports in bundled mode", () => {
    const files: Record<string, string> = {
      "/src/index.ts": `export { ExportedService } from './svc-a';`,
      "/src/svc-a.ts": `@Injectable()\nexport class ExportedService {}`,
      "/src/svc-b.ts": `@Injectable()\nexport class HiddenService {}`,
    };
    // Minimal decorator stubs so scanner sees them.
    const decoratorStub = `function Injectable() { return (c:any)=>{} }`;
    for (const k of Object.keys(files)) {
      files[k] = decoratorStub + "\n" + files[k];
    }
    const emitted = runPlugin(files);
    expect(emitted.length).toBe(2);
    const source = emitted.find((f) =>
      f.fileName.endsWith(".manifest.mjs"),
    )?.source;
    expect(source).toBeDefined();
    expect(source).toMatch(/"missingExports"/);
    expect(source).toMatch(/HiddenService/);
  });

  it("no missing exports when all services exported", () => {
    const files: Record<string, string> = {
      "/src/index.ts": `export { A } from './a'; export { B } from './b';`,
      "/src/a.ts": `@Injectable()\nexport class A {}`,
      "/src/b.ts": `@Injectable()\nexport class B {}`,
    };
    const decoratorStub = `function Injectable() { return (c:any)=>{} }`;
    for (const k of Object.keys(files)) {
      files[k] = decoratorStub + "\n" + files[k];
    }
    const emitted = runPlugin(files);
    const source = emitted.find((f) =>
      f.fileName.endsWith(".manifest.mjs"),
    )?.source;
    expect(source).toBeDefined();
    expect(source).not.toMatch(/"missingExports"/);
  });

  it("derive preserve-modules importPath and no barrel fallback", () => {
    const files: Record<string, string> = {
      "/src/feature/service.ts": `@Injectable()\nexport class PM {}`,
    };
    const decoratorStub = `function Injectable() { return (c:any)=>{} }`;
    for (const k of Object.keys(files)) {
      files[k] = decoratorStub + "\n" + files[k];
    }
    const emitted = runPlugin(files, { preserveModules: true });
    const src = emitted.find((f) =>
      f.fileName.endsWith(".manifest.mjs"),
    )?.source;
    expect(src).toMatch(/"buildMode":\s*"preserve-modules"/);
    expect(src).toMatch(/"importPath":\s*"[^"]+\/feature\/service"/);
    expect(src).toMatch(/"barrelFallback":\s*false/);
  });

  it("duplicate services diagnostic in bundled mode", () => {
    const files: Record<string, string> = {
      "/src/a.ts": `@Injectable()\nexport class Dup {}`,
      "/src/b.ts": `@Injectable()\nexport class Dup {}`,
    };
    const decoratorStub = `function Injectable() { return (c:any)=>{} }`;
    for (const k of Object.keys(files)) {
      files[k] = decoratorStub + "\n" + files[k];
    }
    const emitted = runPlugin(files);
    const src = emitted.find((f) =>
      f.fileName.endsWith(".manifest.mjs"),
    )?.source;
    expect(src).toMatch(/"duplicateServices"/);
    expect(src).toMatch(/Dup\|/);
  });

  it("fallback to fs write when emitFile is missing", () => {
    const files: Record<string, string> = {
      "/src/svc.ts": `function Injectable(){return (c:any)=>{}}\n@Injectable()\nexport class S {}`,
    };
    const plugin = alloy({ fileName: "alloy.test.manifest.mjs" });
    for (const [id, code] of Object.entries(files)) {
      if (plugin.transform) {
        plugin.transform(code, id);
      }
    }
    const origWrite = fs.writeFileSync as unknown as (
      p: string,
      c: string,
    ) => void;
    const capturedWrites: { path: string; code: string }[] = [];
    // override for test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fs as any).writeFileSync = ((p: string, c: string) => {
      capturedWrites.push({ path: p, code: c });
    }) as any;
    try {
      if (plugin.generateBundle) {
        plugin.generateBundle({ preserveModules: false } as any);
      }
      const manifestWrite = capturedWrites.find((w) =>
        w.path.endsWith("alloy.test.manifest.mjs"),
      );
      expect(manifestWrite).toBeDefined();
      expect(manifestWrite?.code).toMatch(/export const manifest/);

      const identifiersWrite = capturedWrites.find((w) =>
        w.path.endsWith("service-identifiers.mjs"),
      );
      expect(identifiersWrite).toBeDefined();
    } finally {
      // restore
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs as any).writeFileSync = origWrite as any;
    }
  });

  it("emits ordered lazy dependency entries in v2 manifests", () => {
    const files: Record<string, string> = {
      "/src/index.ts": `export { Reporter } from './reporting';`,
      "/src/analytics.ts": `@Injectable()\nexport class Analytics {}`,
      "/src/reporting.ts": `@Injectable(deps(Lazy(() => import('./analytics').then(m => m.Analytics))))\nexport class Reporter {}`,
    };
    const stubs = `function Injectable(){return (c:any)=>{}}\nfunction Lazy(x:any){return x}\nfunction deps(...i:any[]){return ()=> i}`;
    for (const k of Object.keys(files)) {
      files[k] = stubs + "\n" + files[k];
    }
    const emitted = runPlugin(files);
    const manifest = readManifest(emitted);
    const reporter = manifest.services.find(
      (svc) => svc.exportName === "Reporter",
    );
    expect(manifest.schemaVersion).toBe(2);
    expect(reporter).toMatchObject({
      exportName: "Reporter",
      deps: [{ kind: "lazy", exportName: "Analytics" }],
    });
  });

  it("preserves dependency order across class, lazy, and token entries", () => {
    const files: Record<string, string> = {
      "/src/index.ts":
        "export { Consumer } from './consumer'; export { DepA } from './dep-a'; export { DepB } from './dep-b'; export { ConfigToken } from './tokens';",
      "/src/dep-a.ts": `@Injectable()\nexport class DepA {}`,
      "/src/dep-b.ts": `@Injectable()\nexport class DepB {}`,
      "/src/tokens.ts": `export const ConfigToken = Symbol('config');`,
      "/src/consumer.ts": `
        import { DepA } from './dep-a';
        import { ConfigToken } from './tokens';
        @Injectable(deps(DepA, Lazy(() => import('./dep-b').then(m => m.DepB)), ConfigToken))
        export class Consumer {}
      `,
    };
    const stubs = `function Injectable(){return (c:any)=>{}}\nfunction Lazy(x:any,y?:any){return x}\nfunction deps(...i:any[]){return ()=> i}`;
    for (const k of Object.keys(files)) {
      files[k] = stubs + "\n" + files[k];
    }

    const manifest = readManifest(runPlugin(files, { preserveModules: true }));
    const consumer = manifest.services.find(
      (svc) => svc.exportName === "Consumer",
    );
    expect(consumer?.deps).toEqual([
      { kind: "class", exportName: "DepA" },
      {
        kind: "lazy",
        exportName: "DepB",
        importPath: "alloy-di/dep-b",
      },
      {
        kind: "token",
        exportName: "ConfigToken",
        importPath: "alloy-di/tokens",
      },
    ]);
  });

  it("keeps lazy dependencies scoped to the declaring service", () => {
    const files: Record<string, string> = {
      "/src/index.ts": `export { First, Second } from './services'; export { DepA } from './dep-a'; export { DepB } from './dep-b';`,
      "/src/dep-a.ts": `@Injectable()\nexport class DepA {}`,
      "/src/dep-b.ts": `@Injectable()\nexport class DepB {}`,
      "/src/services.ts": `
        @Injectable(deps(Lazy(() => import('./dep-a').then(m => m.DepA))))
        export class First {}
        @Injectable(deps(Lazy(() => import('./dep-b').then(m => m.DepB))))
        export class Second {}
      `,
    };
    const stubs = `function Injectable(){return (c:any)=>{}}\nfunction Lazy(x:any,y?:any){return x}\nfunction deps(...i:any[]){return ()=> i}`;
    for (const k of Object.keys(files)) {
      files[k] = stubs + "\n" + files[k];
    }

    const manifest = readManifest(runPlugin(files, { preserveModules: true }));
    const first = manifest.services.find((svc) => svc.exportName === "First");
    const second = manifest.services.find((svc) => svc.exportName === "Second");
    expect(first?.deps).toEqual([
      { kind: "lazy", exportName: "DepA", importPath: "alloy-di/dep-a" },
    ]);
    expect(second?.deps).toEqual([
      { kind: "lazy", exportName: "DepB", importPath: "alloy-di/dep-b" },
    ]);
  });

  it("emits providers in preserve-modules mode", () => {
    const files: Record<string, string> = {
      "/src/index.ts": `export { Reporter } from './reporting';`,
      "/src/reporting.ts": `function Injectable(){return (c:any)=>{}}\nexport class Reporter {}`,
      "/src/providers.ts": `export default {}`,
    };
    const emitted = runPlugin(
      files,
      { preserveModules: true },
      {
        providers: ["src/providers.ts"],
      },
    );
    const src = emitted.find((f) =>
      f.fileName.endsWith(".manifest.mjs"),
    )?.source;
    expect(src).toMatch(/"providers"/);
    expect(src).toMatch(/"alloy-di\/providers"|"UNKNOWN_PACKAGE\/providers"/);
  });

  it("throws when providers used without preserveModules", () => {
    const files: Record<string, string> = {
      "/src/index.ts": `export { Reporter } from './reporting';`,
      "/src/reporting.ts": `function Injectable(){return (c:any)=>{}}\nexport class Reporter {}`,
      "/src/providers.ts": `export default {}`,
    };
    expect(() =>
      runPlugin(
        files,
        { preserveModules: false },
        {
          providers: ["src/providers.ts"],
        },
      ),
    ).toThrow(/requires preserveModules=true/);
  });
});

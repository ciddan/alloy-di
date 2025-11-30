import { describe, it, expect } from "vitest";
import fs from "fs";
import { alloy } from "../../rollup";

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

  it("captures lazyDeps for a service with Lazy dependency", () => {
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
    const src = emitted.find((f) =>
      f.fileName.endsWith(".manifest.mjs"),
    )?.source;
    expect(src).toMatch(/"lazyDeps"/);
    expect(src).toMatch(/Reporter/);
    expect(src).toMatch(/Analytics/);
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

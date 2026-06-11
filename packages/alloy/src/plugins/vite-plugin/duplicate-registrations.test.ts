import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { alloy } from "./index";
import {
  applyConfigResolved,
  applyTransform,
  loadContainer,
} from "./test-utils";

describe("Duplicate registration guard", () => {
  it("throws when a service identity is discovered locally and provided via manifest", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "@scope/lib" }),
    );

    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [
        {
          exportName: "Svc",
          importPath: "@scope/lib/svc",
          symbolKey: "alloy:@scope/lib/src/svc.ts#Svc",
          scope: "transient" as const,
          deps: [],
          lazyDeps: [],
        },
      ],
      providers: [],
    };

    const plugin = alloy({
      manifests: [manifest],
      containerDeclarationDir: tmpDir,
    });
    applyConfigResolved(plugin, {
      root: tmpDir,
    } as unknown as import("vite").ResolvedConfig);

    const id = path.join(tmpDir, "src", "svc.ts");
    applyTransform(
      plugin,
      `
        import { Injectable } from 'alloy-di/runtime';
        @Injectable()
        export class Svc {}
      `,
      id,
    );

    await expect(
      loadContainer(plugin, "\0virtual:alloy-container"),
    ).rejects.toThrow(/Duplicate service registrations detected/);
  });

  it("allows same-name services when their identities differ", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "app-under-test" }),
    );

    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [
        {
          exportName: "Logger",
          importPath: "@scope/lib/logger",
          symbolKey: "alloy:@scope/lib/src/logger.ts#Logger",
          scope: "transient" as const,
          deps: [],
          lazyDeps: [],
        },
      ],
      providers: [],
    };

    const plugin = alloy({
      manifests: [manifest],
      containerDeclarationDir: tmpDir,
    });
    applyConfigResolved(plugin, {
      root: tmpDir,
    } as unknown as import("vite").ResolvedConfig);

    const id = path.join(tmpDir, "src", "logger.ts");
    applyTransform(
      plugin,
      `
        import { Injectable } from 'alloy-di/runtime';
        @Injectable()
        export class Logger {}
      `,
      id,
    );

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;

    expect(generatedCode).toContain("@scope/lib/logger");
    expect(generatedCode).toContain("app-under-test/src/logger.ts#Logger");
  });
});

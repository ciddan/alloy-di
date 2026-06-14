import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generate } from "./generate";
import { loadVirtualContainerModule } from "./plugins/core/container-loader";
import {
  createDiscoveryRuntimeForSourceDirs,
  readPackageName,
} from "./plugins/core/generation-inputs";

const tmpDirs: string[] = [];

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-generate-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "example-app" }),
  );
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("generate", () => {
  it("writes declaration artifacts without loading the virtual module", async () => {
    const root = makeProject();
    fs.writeFileSync(
      path.join(root, "src/service.ts"),
      [
        'import { Singleton } from "alloy-di/runtime";',
        "",
        "@Singleton()",
        "export class Service {}",
      ].join("\n"),
    );

    const result = await generate({ root });
    const dtsPath = path.join(root, "src/alloy-container.d.ts");

    expect(result.serviceCount).toBe(1);
    expect(result.declarationDir).toBe(path.join(root, "src"));
    expect(fs.readFileSync(dtsPath, "utf-8")).toContain(
      "export interface ServiceIdentifiers",
    );
    expect(fs.readFileSync(dtsPath, "utf-8")).toContain(
      "import { Service } from './service.ts';",
    );
  });

  it("uses programmatic options for declaration output and custom scopes", async () => {
    const root = makeProject();
    fs.writeFileSync(
      path.join(root, "src/request-service.ts"),
      [
        'import { Injectable } from "alloy-di/runtime";',
        "",
        '@Injectable("request")',
        "export class RequestService {}",
      ].join("\n"),
    );

    const result = await generate({
      root,
      containerDeclarationDir: "generated",
      scopes: {
        request: {},
      },
    });

    const scopeDts = fs.readFileSync(
      path.join(root, "generated/alloy-scopes.d.ts"),
      "utf-8",
    );
    expect(result.declarationDir).toBe(path.join(root, "generated"));
    expect(scopeDts).toContain('"request": true;');
  });

  it("scans configured source directories", async () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, "app"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "app/service.ts"),
      [
        'import { Singleton } from "alloy-di/runtime";',
        "",
        "@Singleton()",
        "export class AppService {}",
      ].join("\n"),
    );

    const result = await generate({ root, sourceDirs: ["app"] });
    const dtsPath = path.join(root, "src/alloy-container.d.ts");

    expect(result.serviceCount).toBe(1);
    expect(fs.readFileSync(dtsPath, "utf-8")).toContain(
      "import { AppService } from '../app/service.ts';",
    );
  });

  it("writes byte-identical declarations to the Vite container loader path", async () => {
    const root = makeProject();
    fs.mkdirSync(path.join(root, "app"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "app/core.ts"),
      [
        'import { Singleton } from "alloy-di/runtime";',
        "",
        "@Singleton()",
        "export class Core {}",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "app/request-service.ts"),
      [
        'import { Injectable } from "alloy-di/runtime";',
        'import { Core } from "./core";',
        "",
        '@Injectable(() => [Core], "request")',
        "export class RequestService {}",
      ].join("\n"),
    );

    const sourceDirs = ["app"];
    const scopes = { request: {} };

    await generate({
      root,
      sourceDirs,
      scopes,
      containerDeclarationDir: "generate-types",
    });

    const discoveryRuntime = createDiscoveryRuntimeForSourceDirs(
      root,
      sourceDirs,
      {
        factoryProviders: false,
      },
    );
    await loadVirtualContainerModule({
      localMetas: Array.from(discoveryRuntime.discoveredClasses.values()),
      lazyReferencedClassKeys: discoveryRuntime.lazyReferencedClassKeys,
      manifests: [],
      providerImportPaths: [],
      factoryProviders: [],
      lazyServiceKeys: new Set<string>(),
      packageName: readPackageName(root),
      resolvedRoot: root,
      containerDeclarationDir: "loader-types",
      resolvedVisualization: null,
      scopes,
    });

    for (const fileName of ["alloy-container.d.ts", "alloy-scopes.d.ts"]) {
      expect(
        fs.readFileSync(path.join(root, "generate-types", fileName), "utf-8"),
      ).toBe(
        fs.readFileSync(path.join(root, "loader-types", fileName), "utf-8"),
      );
    }
  });
});

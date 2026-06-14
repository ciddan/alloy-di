import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERATED_FILE_NOTICE } from "./codegen";
import { loadVirtualContainerModule } from "./container-loader";
import type { AlloyManifest, DiscoveredMeta } from "./types";

function makeMetas(): DiscoveredMeta[] {
  return [
    {
      className: "Core",
      filePath: "/src/core.ts",
      metadata: { scope: "singleton", dependencies: [] },
    },
    {
      className: "Consumer",
      filePath: "/src/consumer.ts",
      metadata: {
        scope: "singleton",
        dependencies: [
          {
            expression: "Core",
            referencedIdentifiers: ["Core"],
            isLazy: false,
          },
        ],
      },
      referencedImports: [
        { name: "Core", path: "/src/core.ts", originalName: "Core" },
      ],
    },
  ];
}

const tmpDirs: string[] = [];

function makeOutDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-loader-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The loader runs on every HMR-triggered container regeneration, so it must
 * not mutate the discovery runtime's shared state: the cached metas (factory
 * injection would poison the change-detection signature) and the live
 * lazy-key set (manifest additions and eager-reference deletions would leak
 * into later regenerations).
 */
describe("loadVirtualContainerModule input isolation", () => {
  const manifestWithLazyDep: AlloyManifest = {
    schemaVersion: 2,
    packageName: "lib",
    buildMode: "preserve-modules",
    services: [
      {
        importPath: "lib/feature",
        exportName: "Feature",
        symbolKey: "alloy:lib/feature#Feature",
        scope: "singleton",
        deps: [
          { kind: "lazy", exportName: "Widget", importPath: "lib/widget" },
        ],
      },
    ],
  };

  it("does not mutate the caller's metas or lazy-key set", async () => {
    const localMetas = makeMetas();
    const coreMeta = localMetas[0];
    // Core is referenced both lazily (key present) and eagerly (Consumer dep);
    // reconciliation must happen on a copy, not on this set.
    const lazyReferencedClassKeys = new Set(["/src/core.ts::Core"]);
    // Matches the identifierKey the loader assigns for resolvedRoot "/".
    const lazyServiceKeys = new Set(["alloy:test-pkg/src/core.ts#Core"]);
    const outDir = makeOutDir();

    await loadVirtualContainerModule({
      localMetas,
      lazyReferencedClassKeys,
      manifests: [manifestWithLazyDep],
      providerImportPaths: [],
      factoryProviders: [],
      lazyServiceKeys,
      packageName: "test-pkg",
      resolvedRoot: "/",
      containerDeclarationDir: outDir,
      resolvedVisualization: null,
    });

    // Manifest services are appended to a copy, not the caller's array.
    expect(localMetas).toHaveLength(2);
    // augmentFactoryLazyServices must not write into the cached meta.
    expect(coreMeta.metadata.factory).toBeUndefined();
    // assignIdentifierKeys must not write into the cached meta.
    expect(coreMeta.identifierKey).toBeUndefined();
    // No deletion from reconcileLazySet, no addition from the manifest lazy dep.
    expect(lazyReferencedClassKeys).toEqual(new Set(["/src/core.ts::Core"]));
  });

  it("produces identical output when invoked twice with the same inputs", async () => {
    const outDir = makeOutDir();
    const load = () =>
      loadVirtualContainerModule({
        localMetas: makeMetas(),
        lazyReferencedClassKeys: new Set(["/src/core.ts::Core"]),
        manifests: [manifestWithLazyDep],
        providerImportPaths: [],
        factoryProviders: [],
        lazyServiceKeys: new Set<string>(),
        packageName: "test-pkg",
        resolvedRoot: "/",
        containerDeclarationDir: outDir,
        resolvedVisualization: null,
      });

    const first = await load();
    const second = await load();
    expect(second.code).toBe(first.code);
  });

  it("does not rewrite unchanged artifacts on regeneration (issue #23)", async () => {
    const outDir = makeOutDir();
    const load = () =>
      loadVirtualContainerModule({
        localMetas: makeMetas(),
        lazyReferencedClassKeys: new Set<string>(),
        manifests: [manifestWithLazyDep],
        providerImportPaths: [],
        factoryProviders: [],
        lazyServiceKeys: new Set<string>(),
        packageName: "test-pkg",
        resolvedRoot: "/",
        containerDeclarationDir: outDir,
        resolvedVisualization: {
          outputPath: path.join(outDir, "alloy-di.mmd"),
        },
      });

    await load();
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    await load();
    const artifactWrites = writeSpy.mock.calls.filter(
      ([target]) => typeof target === "string" && target.startsWith(outDir),
    );
    expect(artifactWrites).toHaveLength(0);
  });

  it("prepends the generated-file notice to the mermaid artifact", async () => {
    const outDir = makeOutDir();
    const mermaidPath = path.join(outDir, "alloy-di.mmd");

    await loadVirtualContainerModule({
      localMetas: makeMetas(),
      lazyReferencedClassKeys: new Set<string>(),
      manifests: [],
      providerImportPaths: [],
      factoryProviders: [],
      lazyServiceKeys: new Set<string>(),
      packageName: "test-pkg",
      resolvedRoot: "/",
      containerDeclarationDir: outDir,
      resolvedVisualization: { outputPath: mermaidPath },
    });

    const mermaid = fs.readFileSync(mermaidPath, "utf-8");
    expect(mermaid.startsWith(`%% ${GENERATED_FILE_NOTICE}\n`)).toBe(true);
  });
});

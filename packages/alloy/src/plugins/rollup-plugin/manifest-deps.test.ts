import { describe, it, expect } from "vitest";
import { createManifestDependency } from "./manifest-deps";
import type { DependencyDescriptor, DiscoveredMeta } from "../core/types";

function meta(partial: Partial<DiscoveredMeta> = {}): DiscoveredMeta {
  return {
    className: "Consumer",
    filePath: "/proj/src/consumer.ts",
    metadata: { scope: "transient", dependencies: [] },
    ...partial,
  } as DiscoveredMeta;
}

function dep(partial: Partial<DependencyDescriptor>): DependencyDescriptor {
  return {
    expression: "",
    referencedIdentifiers: [],
    isLazy: false,
    ...partial,
  };
}

const known = new Set(["DepA"]);

describe("createManifestDependency", () => {
  it("classifies a known class dependency", () => {
    const d = dep({ expression: "DepA", referencedIdentifiers: ["DepA"] });
    expect(
      createManifestDependency(d, meta(), known, "pkg", "preserve-modules"),
    ).toEqual({ kind: "class", exportName: "DepA" });
  });

  it("classifies a token dependency and resolves its import path", () => {
    const m = meta({
      referencedImports: [
        { name: "ConfigToken", path: "./tokens", originalName: "ConfigToken" },
      ],
    });
    const d = dep({
      expression: "ConfigToken",
      referencedIdentifiers: ["ConfigToken"],
    });
    expect(
      createManifestDependency(d, m, known, "pkg", "preserve-modules"),
    ).toEqual({
      kind: "token",
      exportName: "ConfigToken",
      importPath: "pkg/tokens",
    });
  });

  it("classifies a lazy dependency and resolves its import path", () => {
    const d = dep({
      expression: "Lazy(() => import('./dep-b').then(m => m.DepB))",
      isLazy: true,
    });
    expect(
      createManifestDependency(d, meta(), known, "pkg", "preserve-modules"),
    ).toEqual({ kind: "lazy", exportName: "DepB", importPath: "pkg/dep-b" });
  });

  it("returns null for an unparseable lazy dependency", () => {
    const d = dep({ expression: "notLazyAtAll", isLazy: true });
    expect(
      createManifestDependency(d, meta(), known, "pkg", "preserve-modules"),
    ).toBeNull();
  });
});

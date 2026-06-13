import { describe, it, expect } from "vitest";
import {
  getDependencyImports,
  getDependencyReferenceName,
  resolveClassDependencyName,
} from "./dependency-resolution";
import type { DependencyDescriptor, DiscoveredMeta } from "../core/types";

function meta(partial: Partial<DiscoveredMeta> = {}): DiscoveredMeta {
  return {
    className: "Svc",
    filePath: "/proj/src/svc.ts",
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

describe("getDependencyImports", () => {
  it("filters referencedImports to the dependency's identifiers", () => {
    const m = meta({
      referencedImports: [
        { name: "DepA", path: "./dep-a" },
        { name: "Other", path: "./other" },
      ],
    });
    expect(
      getDependencyImports(m, dep({ referencedIdentifiers: ["DepA"] })),
    ).toEqual([{ name: "DepA", path: "./dep-a" }]);
  });

  it("returns empty when the dependency references no identifiers", () => {
    const m = meta({ referencedImports: [{ name: "DepA", path: "./dep-a" }] });
    expect(getDependencyImports(m, dep({ referencedIdentifiers: [] }))).toEqual(
      [],
    );
  });
});

describe("getDependencyReferenceName", () => {
  it("reads a plain identifier", () => {
    expect(getDependencyReferenceName("DepA")).toBe("DepA");
  });

  it("reads the trailing name of a property access", () => {
    expect(getDependencyReferenceName("ns.DepA")).toBe("DepA");
  });

  it("peels an as-expression", () => {
    expect(getDependencyReferenceName("DepA as Foo")).toBe("DepA");
  });

  it("peels parentheses", () => {
    expect(getDependencyReferenceName("(DepA)")).toBe("DepA");
  });

  it("returns undefined for a non-reference expression", () => {
    expect(getDependencyReferenceName("123")).toBeUndefined();
  });
});

describe("resolveClassDependencyName", () => {
  const known = new Set(["DepA"]);

  it("matches through an imported original (aliased) name", () => {
    const m = meta({
      referencedImports: [
        { name: "Aliased", path: "./a", originalName: "DepA" },
      ],
    });
    const d = dep({
      expression: "Aliased",
      referencedIdentifiers: ["Aliased"],
    });
    expect(resolveClassDependencyName(d, m, known)).toBe("DepA");
  });

  it("matches through the parsed reference name", () => {
    const d = dep({ expression: "DepA", referencedIdentifiers: ["DepA"] });
    expect(resolveClassDependencyName(d, meta(), known)).toBe("DepA");
  });

  it("returns undefined when nothing matches a known service", () => {
    const d = dep({ expression: "Nope", referencedIdentifiers: ["Nope"] });
    expect(resolveClassDependencyName(d, meta(), known)).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import {
  determineBuildMode,
  resolveImportPathForBuild,
  hasPreserveModules,
} from "./build-utils";

describe("determineBuildMode", () => {
  it("is preserve-modules whenever preserveModules is set", () => {
    expect(determineBuildMode(true, 5)).toBe("preserve-modules");
    expect(determineBuildMode(true, 0)).toBe("preserve-modules");
  });

  it("is chunks for >1 service without preserveModules", () => {
    expect(determineBuildMode(false, 2)).toBe("chunks");
  });

  it("is bundled for <=1 service without preserveModules", () => {
    expect(determineBuildMode(false, 1)).toBe("bundled");
    expect(determineBuildMode(false, 0)).toBe("bundled");
  });
});

describe("resolveImportPathForBuild", () => {
  it("derives a /src subpath in preserve-modules mode", () => {
    expect(
      resolveImportPathForBuild(
        "/proj/src/feature/service.ts",
        "pkg",
        "preserve-modules",
      ),
    ).toBe("pkg/feature/service");
  });

  it("falls back to the package root when no /src/ segment exists", () => {
    expect(
      resolveImportPathForBuild(
        "/proj/lib/service.ts",
        "pkg",
        "preserve-modules",
      ),
    ).toBe("pkg");
  });

  it("uses the basename as the subpath in chunks mode", () => {
    expect(
      resolveImportPathForBuild(
        "/proj/src/feature/service.ts",
        "pkg",
        "chunks",
      ),
    ).toBe("pkg/service");
  });

  it("uses the package root in bundled mode", () => {
    expect(
      resolveImportPathForBuild(
        "/proj/src/feature/service.ts",
        "pkg",
        "bundled",
      ),
    ).toBe("pkg");
  });
});

describe("hasPreserveModules", () => {
  it("is true for an object carrying the preserveModules key", () => {
    expect(hasPreserveModules({ preserveModules: true })).toBe(true);
    expect(hasPreserveModules({ preserveModules: false })).toBe(true);
  });

  it("is false for non-objects or objects without the key", () => {
    expect(hasPreserveModules(undefined)).toBe(false);
    expect(hasPreserveModules(null)).toBe(false);
    expect(hasPreserveModules({})).toBe(false);
  });
});

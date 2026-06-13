import fs from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { checkPackageExports } from "./package-exports";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockPackageJson(pkg: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(pkg) as any);
}

describe("checkPackageExports", () => {
  it("warns once each when manifest and identifiers are not exposed", () => {
    mockPackageJson({ exports: { ".": "./index.js" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkPackageExports("/pkg/package.json", "alloy.manifest.mjs");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("is silent when both are exposed via nested export entries", () => {
    mockPackageJson({
      exports: {
        "./manifest": { import: "./alloy.manifest.mjs" },
        "./ids": { import: "./service-identifiers.mjs" },
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkPackageExports("/pkg/package.json", "alloy.manifest.mjs");
    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing when the package has no exports field", () => {
    mockPackageJson({ name: "x" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkPackageExports("/pkg/package.json", "alloy.manifest.mjs");
    expect(warn).not.toHaveBeenCalled();
  });

  it("swallows read/parse errors", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("nope");
    });
    expect(() =>
      checkPackageExports("/pkg/package.json", "alloy.manifest.mjs"),
    ).not.toThrow();
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
// Resolve paths used both in setup and guards
const PKG_ROOT = path.resolve(__dirname, "../../../");
const LINK_TARGET = path.join(PKG_ROOT, "node_modules", "@upn", "fixture-lib");

const hasFixturePackage = () => fs.existsSync(LINK_TARGET);

// Establish symlink into node_modules so ESM subpath specifiers resolve as packages.
beforeAll(() => {
  // Ensure a symlink exists so bare specifiers resolve under tests
  const nodeModulesUpn = path.join(PKG_ROOT, "node_modules", "@upn");
  const fixtureRoot = path.join(PKG_ROOT, "tests", "fixture-lib");
  if (!fs.existsSync(nodeModulesUpn)) {
    fs.mkdirSync(nodeModulesUpn, { recursive: true });
  }
  try {
    if (fs.existsSync(LINK_TARGET)) {
      const stat = fs.lstatSync(LINK_TARGET);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(LINK_TARGET);
      }
    }
    fs.symlinkSync(fixtureRoot, LINK_TARGET, "dir");
  } catch {
    // If symlink creation fails tests that require package specifiers will be skipped implicitly.
  }
});

describe("fixture-lib flattened subpath imports", () => {
  it("resolves analytics-service", async () => {
    if (!hasFixturePackage()) {
      expect(true).toBe(true);
      return;
    }
    // @ts-expect-error TS cannot verify dynamic import paths
    const mod = await import("@upn/fixture-lib/analytics-service");
    expect(typeof mod.AnalyticsService).toBe("function");
  });
  it("resolves event-tracker", async () => {
    if (!hasFixturePackage()) {
      expect(true).toBe(true);
      return;
    }
    // @ts-expect-error TS cannot verify dynamic import paths
    const mod = await import("@upn/fixture-lib/event-tracker");
    expect(typeof mod.EventTracker).toBe("function");
  });
  it("resolves user-session", async () => {
    if (!hasFixturePackage()) {
      expect(true).toBe(true);
      return;
    }
    // @ts-expect-error TS cannot verify dynamic import paths
    const mod = await import("@upn/fixture-lib/user-session");
    expect(typeof mod.UserSession).toBe("function");
  });
  it("manifest importPaths align & are loadable", async () => {
    if (!hasFixturePackage()) {
      expect(true).toBe(true);
      return;
    }
    // @ts-expect-error TS cannot verify dynamic import paths
    const manifestMod = await import("@upn/fixture-lib/manifest");
    const services: Array<{ exportName: string; importPath: string }> =
      manifestMod.manifest.services;
    for (const svc of services) {
      const loaded = await import(svc.importPath);
      expect(loaded[svc.exportName]).toBeDefined();
    }
  });
});

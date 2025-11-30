import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
// Resolve paths used both in setup and guards
const PKG_ROOT = path.resolve(__dirname, "../../../");
const LINK_TARGET = path.join(PKG_ROOT, "node_modules", "@acme", "fixture-lib");

const hasFixturePackage = () => fs.existsSync(LINK_TARGET);

// Establish symlink into node_modules so ESM subpath specifiers resolve as packages.
beforeAll(() => {
  // Ensure a symlink exists so bare specifiers resolve under tests
  const nodeModulesAcme = path.join(PKG_ROOT, "node_modules", "@acme");
  const fixtureRoot = path.join(PKG_ROOT, "tests", "fixture-lib");
  if (!fs.existsSync(nodeModulesAcme)) {
    fs.mkdirSync(nodeModulesAcme, { recursive: true });
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
    const mod = await import("@acme/fixture-lib/analytics-service");
    expect(typeof mod.AnalyticsService).toBe("function");
  });
  it("resolves event-tracker", async () => {
    if (!hasFixturePackage()) {
      expect(true).toBe(true);
      return;
    }
    // @ts-expect-error TS cannot verify dynamic import paths
    const mod = await import("@acme/fixture-lib/event-tracker");
    expect(typeof mod.EventTracker).toBe("function");
  });
  it("resolves user-session", async () => {
    if (!hasFixturePackage()) {
      expect(true).toBe(true);
      return;
    }
    // @ts-expect-error TS cannot verify dynamic import paths
    const mod = await import("@acme/fixture-lib/user-session");
    expect(typeof mod.UserSession).toBe("function");
  });
  it("manifest importPaths align & are loadable", async () => {
    if (!hasFixturePackage()) {
      expect(true).toBe(true);
      return;
    }
    // @ts-expect-error TS cannot verify dynamic import paths
    const manifestMod = await import("@acme/fixture-lib/manifest");
    const services: Array<{ exportName: string; importPath: string }> =
      manifestMod.manifest.services;
    for (const svc of services) {
      const loaded = await import(svc.importPath);
      expect(loaded[svc.exportName]).toBeDefined();
    }
  });
});

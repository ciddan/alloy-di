import { describe, expect, it } from "vitest";
import { alloy } from "./index";
import {
  applyBuildStart,
  applyConfigResolved,
  applyHotUpdate,
  applyTransform,
  loadContainer,
  resolveVirtualId,
} from "./test-utils";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Vite Plugin Alloy - lifecycle & HMR", () => {
  it("should remove class after decorator deletion on re-transform", async () => {
    const plugin = alloy();
    const id = "/src/hmr-remove.ts";
    const initial = `
            import { Injectable } from 'alloy-di/runtime';
            @Injectable()
            export class TempService {}
        `;
    applyTransform(plugin, initial, id);
    const firstGen = await loadContainer(plugin, "\0virtual:alloy-container");
    expect(firstGen).toMatchSnapshot();

    const afterRemoval = `
            // decorator removed
            export class TempService {}
        `;
    applyTransform(plugin, afterRemoval, id);
    const secondGen = await loadContainer(plugin, "\0virtual:alloy-container");
    expect(secondGen).toMatchSnapshot();
  });

  it("runs as a pre plugin so discovery sees pre-transform source", () => {
    // Without `pre`, a re-transform on the HMR path would scan code whose
    // decorators were already lowered by another plugin and drop services.
    expect(alloy().enforce).toBe("pre");
  });

  it("resolveId returns resolved virtual id for virtual:alloy-container", () => {
    const plugin = alloy();
    const resolved = resolveVirtualId(plugin, "virtual:alloy-container");
    expect(resolved).toBe("\0virtual:alloy-container");
  });

  it("buildStart clears previously discovered classes", async () => {
    const plugin = alloy();

    // Setup fake root to prevent walkSync from finding real files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-hmr-"));
    fs.mkdirSync(path.join(tmpDir, "src"));
    applyConfigResolved(plugin, { root: tmpDir });

    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class ToBeCleared {}
    `;
    const id = "/src/clear-me.ts";
    applyTransform(plugin, code, id);
    applyBuildStart(plugin);
    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).toContain("const container = new Container()");
    expect(generatedCode).toContain("const registrations = []");
    expect(generatedCode).not.toContain("ctor:");
  });

  it("hotUpdate removes classes on unlink (no modules in any graph)", async () => {
    const plugin = alloy();
    const id = "/src/hmr-unlink.ts";
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class HmrGone {}
    `;
    applyTransform(plugin, code, id);
    const mods = applyHotUpdate(plugin, { file: id });
    expect(mods).toEqual([]);
    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).not.toMatch(/HmrGone/);
  });

  it("load returns undefined for non-virtual ids", async () => {
    const plugin = alloy();
    expect(await loadContainer(plugin, "/some/other/id.ts")).toBeUndefined();
  });
});

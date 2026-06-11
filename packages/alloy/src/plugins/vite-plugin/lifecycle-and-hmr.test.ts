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

  it("hotUpdate purges + reloads when a service file is deleted", async () => {
    const plugin = alloy();
    const id = "/src/hmr-unlink.ts";
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class HmrGone {}
    `;
    applyTransform(plugin, code, id);

    const { result, invalidatedIds, sent } = await applyHotUpdate(plugin, {
      file: id,
      type: "delete",
    });

    // Discovery change forces a custom (full-reload) update, so the hook
    // returns an empty module list and triggers the reload itself.
    expect(result).toEqual([]);
    expect(invalidatedIds).toContain("\0virtual:alloy-container");
    expect(sent).toContainEqual({ type: "full-reload" });

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).not.toMatch(/HmrGone/);
  });

  it("hotUpdate reloads + regenerates when a service's deps change", async () => {
    const plugin = alloy();
    const id = "/src/hmr-deps.ts";
    const before = `
      import { Singleton } from 'alloy-di/runtime';
      import { Dep } from './dep';
      @Singleton(() => [Dep])
      export class Svc {}
    `;
    applyTransform(plugin, before, id);
    const firstGen = await loadContainer(plugin, "\0virtual:alloy-container");
    expect(firstGen).toMatch(/dependencies: \(\) => \[Dep\]/);

    const after = `
      import { Singleton } from 'alloy-di/runtime';
      @Singleton()
      export class Svc {}
    `;
    const { result, invalidatedIds, sent } = await applyHotUpdate(plugin, {
      file: id,
      type: "update",
      code: after,
    });

    expect(result).toEqual([]);
    expect(invalidatedIds).toContain("\0virtual:alloy-container");
    expect(sent).toContainEqual({ type: "full-reload" });

    const secondGen = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(secondGen).not.toMatch(/dependencies: \(\) => \[Dep\]/);
  });

  it("hotUpdate discovers a newly created service file", async () => {
    const plugin = alloy();
    const id = "/src/hmr-new.ts";
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class FreshlyAdded {}
    `;

    const { result, invalidatedIds, sent } = await applyHotUpdate(plugin, {
      file: id,
      type: "create",
      code,
    });

    expect(result).toEqual([]);
    expect(invalidatedIds).toContain("\0virtual:alloy-container");
    expect(sent).toContainEqual({ type: "full-reload" });

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).toMatch(/FreshlyAdded/);
  });

  it("hotUpdate leaves normal HMR alone for non-discovery edits", async () => {
    const plugin = alloy();
    const id = "/src/hmr-body.ts";
    const before = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class Stable {
        value() { return 1; }
      }
    `;
    applyTransform(plugin, before, id);

    const after = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class Stable {
        value() { return 2; }
      }
    `;
    const { result, invalidatedIds, sent } = await applyHotUpdate(plugin, {
      file: id,
      type: "update",
      code: after,
    });

    // No codegen-relevant change: hand back to Vite's default HMR.
    expect(result).toBeUndefined();
    expect(invalidatedIds).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("hotUpdate ignores files outside the discovery scope", async () => {
    const plugin = alloy();
    const { result, invalidatedIds, sent } = await applyHotUpdate(plugin, {
      file: "/src/styles.css",
      type: "update",
      code: ".x { color: red; }",
    });

    expect(result).toBeUndefined();
    expect(invalidatedIds).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("load returns undefined for non-virtual ids", async () => {
    const plugin = alloy();
    expect(await loadContainer(plugin, "/some/other/id.ts")).toBeUndefined();
  });
});

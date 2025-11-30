import { describe, expect, it } from "vitest";
import { alloy } from "./index";
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
    // @ts-expect-error - calling transform for testing
    plugin.transform(initial, id);
    // @ts-expect-error - calling load for testing
    const firstGen = await plugin.load("\0virtual:alloy-container");
    expect(firstGen).toMatchSnapshot();

    const afterRemoval = `
            // decorator removed
            export class TempService {}
        `;
    // @ts-expect-error - calling transform for testing
    plugin.transform(afterRemoval, id);
    // @ts-expect-error - calling load for testing
    const secondGen = await plugin.load("\0virtual:alloy-container");
    expect(secondGen).toMatchSnapshot();
  });

  it("resolveId returns resolved virtual id for virtual:alloy-container", () => {
    const plugin = alloy();
    // @ts-expect-error calling hook directly
    const resolved = plugin.resolveId("virtual:alloy-container");
    expect(resolved).toBe("\0virtual:alloy-container");
  });

  it("buildStart clears previously discovered classes", async () => {
    const plugin = alloy();

    // Setup fake root to prevent walkSync from finding real files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-hmr-"));
    fs.mkdirSync(path.join(tmpDir, "src"));
    if (plugin.configResolved) {
      // @ts-expect-error
      plugin.configResolved({ root: tmpDir });
    }

    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class ToBeCleared {}
    `;
    const id = "/src/clear-me.ts";
    // @ts-expect-error - calling transform for testing
    plugin.transform(code, id);
    // @ts-expect-error - calling buildStart for testing
    plugin.buildStart();
    // @ts-expect-error - calling load for testing
    const generatedCode = (await plugin.load(
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).toContain("const container = new Container()");
    expect(generatedCode).toContain("const registrations = []");
    expect(generatedCode).not.toContain("ctor:");
  });

  it("handleHotUpdate removes classes on unlink (no modules)", async () => {
    const plugin = alloy();
    const id = "/src/hmr-unlink.ts";
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class HmrGone {}
    `;
    // @ts-expect-error - calling transform for testing
    plugin.transform(code, id);
    // @ts-expect-error - calling handleHotUpdate for testing
    const mods = plugin.handleHotUpdate({ file: id, modules: [] });
    expect(mods).toEqual([]);
    // @ts-expect-error - calling load for testing
    const generatedCode = (await plugin.load(
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).not.toMatch(/HmrGone/);
  });

  it("load returns undefined for non-virtual ids", async () => {
    const plugin = alloy();
    // @ts-expect-error - calling load for testing
    expect(await plugin.load("/some/other/id.ts")).toBeUndefined();
  });
});

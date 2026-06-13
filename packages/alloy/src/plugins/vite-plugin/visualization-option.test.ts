import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResolvedConfig } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { alloy } from "./index";
import { applyTransform, loadContainer } from "./test-utils";

describe("Vite Plugin Alloy - visualize option", () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it("emits a Mermaid diagram to the configured output path", async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-vis-"));
    const containerDir = path.join(tmpRoot, "types");
    const diagramPath = path.join(tmpRoot, "artifacts", "overview.mmd");

    const plugin = alloy({
      containerDeclarationDir: containerDir,
      visualize: {
        mermaid: {
          outputPath: diagramPath,
          direction: "TB",
        },
      },
    });

    const config: ResolvedConfig = { root: tmpRoot } as ResolvedConfig;
    const configHook = plugin.configResolved;
    if (typeof configHook === "function") {
      await configHook.call({} as never, config);
    } else if (configHook && typeof configHook.handler === "function") {
      await configHook.handler.call({} as never, config);
    }

    const depCode = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class DepService {}
    `;
    const serviceCode = `
      import { Injectable } from 'alloy-di/runtime';
      import { DepService } from './dep';
      @Injectable(() => [DepService])
      export class MainService {}
    `;

    const depId = path.join(tmpRoot, "src", "dep.ts");
    const mainId = path.join(tmpRoot, "src", "main.ts");

    applyTransform(plugin, depCode, depId);
    applyTransform(plugin, serviceCode, mainId);

    const generated = await loadContainer(plugin, "\0virtual:alloy-container");
    expect(typeof generated).toBe("string");

    expect(fs.existsSync(diagramPath)).toBe(true);
    const diagram = fs.readFileSync(diagramPath, "utf-8");

    expect(diagram).toContain("graph TB");
    expect(diagram).toContain('["MainService"]');
    expect(diagram).toContain('["DepService"]');
    expect(diagram).toMatch(/-->\|Tr→Tr\|/);
    expect(diagram.trim().length).toBeGreaterThan(0);
  });
});

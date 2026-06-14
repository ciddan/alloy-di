import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALLOY_PLUGIN_OPTIONS } from "./consumer-plugin";
import { alloy as webpackAlloy } from "../webpack";
import { alloy as rspackAlloy } from "../rspack";

const tmpDirs: string[] = [];

class Hook {
  handlers: ((...args: unknown[]) => unknown)[] = [];

  tap(_name: string, handler: (...args: unknown[]) => unknown): void {
    this.handlers.push(handler);
  }

  tapPromise(
    _name: string,
    handler: (...args: unknown[]) => Promise<unknown>,
  ): void {
    this.handlers.push(handler);
  }

  async call(...args: unknown[]): Promise<void> {
    for (const handler of this.handlers) {
      await handler(...args);
    }
  }
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-webpack-"));
  tmpDirs.push(root);
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}');
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src/service.ts"),
    `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class WebpackService {}
    `,
  );
  return root;
}

function makeCompiler(root: string) {
  return {
    context: root,
    options: {
      context: root,
      mode: "development",
      resolve: {},
    },
    hooks: {
      beforeRun: new Hook(),
      run: new Hook(),
      watchRun: new Hook(),
      beforeCompile: new Hook(),
      thisCompilation: new Hook(),
      normalModuleFactory: new Hook(),
    },
  };
}

function getAlias(compiler: ReturnType<typeof makeCompiler>, key: string) {
  return (compiler.options.resolve as { alias?: Record<string, string> })
    .alias?.[key];
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("webpack-like Alloy plugins", () => {
  it("creates a webpack plugin with metadata and virtual module alias", async () => {
    const root = makeRoot();
    const compiler = makeCompiler(root);
    const options = { sourceDirs: ["src"] };
    const plugin = webpackAlloy(options);

    plugin.apply(compiler);
    await compiler.hooks.beforeCompile.call();

    const cachePath = getAlias(compiler, "virtual:alloy-container");

    expect(plugin[ALLOY_PLUGIN_OPTIONS]).toBe(options);
    expect(cachePath).toBe(
      path.join(
        root,
        "node_modules/.cache/alloy-di/webpack-virtual-container.js",
      ),
    );
    expect(fs.readFileSync(String(cachePath), "utf-8")).toContain(
      "WebpackService",
    );
  });

  it("creates an Rspack plugin with separate name and cache file", async () => {
    const root = makeRoot();
    const compiler = makeCompiler(root);
    const plugin = rspackAlloy();

    plugin.apply(compiler);
    await compiler.hooks.beforeCompile.call();

    expect(plugin.name).toBe("alloy-di-rspack");
    expect(getAlias(compiler, "virtual:alloy-container")).toBe(
      path.join(
        root,
        "node_modules/.cache/alloy-di/rspack-virtual-container.js",
      ),
    );
  });

  it("rewrites virtual module requests through normal module factory hooks", async () => {
    const root = makeRoot();
    const compiler = makeCompiler(root);
    const beforeResolve = new Hook();
    const factory = { hooks: { beforeResolve } };
    const request = { request: "virtual:alloy-container" };

    webpackAlloy().apply(compiler);
    await compiler.hooks.normalModuleFactory.call(factory);
    await beforeResolve.call(request);

    expect(request.request).toBe(
      path.join(
        root,
        "node_modules/.cache/alloy-di/webpack-virtual-container.js",
      ),
    );
  });
});

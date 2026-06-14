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

function makeCompiler(root: string, mode: string | undefined = "development") {
  return {
    context: root,
    options: {
      context: root,
      mode,
      resolve: {} as {
        alias?:
          | Record<string, string>
          | { name?: string; alias?: string | false | string[] }[];
      },
    },
    hooks: {
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

function webpackCachePath(root: string): string {
  return path.join(
    root,
    "node_modules/.cache/alloy-di/webpack-virtual-container.js",
  );
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

    expect(request.request).toBe(webpackCachePath(root));
  });

  it("writes a well-formed container module to the cache file", async () => {
    const root = makeRoot();
    const compiler = makeCompiler(root);

    webpackAlloy({ sourceDirs: ["src"] }).apply(compiler);
    await compiler.hooks.beforeCompile.call();

    const code = fs.readFileSync(webpackCachePath(root), "utf-8");
    expect(code).toContain("from 'alloy-di/runtime'");
    expect(code).toContain("Container");
    expect(code).toContain("dependenciesRegistry.set");
    expect(code).toContain("{ ctor: WebpackService");
    expect(code).toContain("export default container");
  });

  it("injects the bundler mode into the generated module", async () => {
    const devRoot = makeRoot();
    const devCompiler = makeCompiler(devRoot, "development");
    webpackAlloy().apply(devCompiler);
    await devCompiler.hooks.beforeCompile.call();
    expect(fs.readFileSync(webpackCachePath(devRoot), "utf-8")).toContain(
      "setEnvDetectionOverrides({ isDev: true })",
    );

    const prodRoot = makeRoot();
    const prodCompiler = makeCompiler(prodRoot, "production");
    webpackAlloy().apply(prodCompiler);
    await prodCompiler.hooks.beforeCompile.call();
    expect(fs.readFileSync(webpackCachePath(prodRoot), "utf-8")).toContain(
      "setEnvDetectionOverrides({ isDev: false })",
    );
  });

  it("registers the cache file and source dirs as build dependencies", async () => {
    const root = makeRoot();
    const compiler = makeCompiler(root);
    const fileDependencies = new Set<string>();
    const contextDependencies = new Set<string>();

    webpackAlloy({ sourceDirs: ["src"] }).apply(compiler);
    await compiler.hooks.thisCompilation.call({
      fileDependencies,
      contextDependencies,
    });

    expect(fileDependencies.has(webpackCachePath(root))).toBe(true);
    expect(contextDependencies.has(path.join(root, "src"))).toBe(true);
  });

  it("appends to an array-form resolve.alias and updates an existing entry", async () => {
    const root = makeRoot();

    // New entry is pushed when none exists.
    const fresh = makeCompiler(root);
    fresh.options.resolve.alias = [];
    webpackAlloy().apply(fresh);
    expect(fresh.options.resolve.alias).toEqual([
      { name: "virtual:alloy-container", alias: webpackCachePath(root) },
    ]);

    // An existing entry is updated in place rather than duplicated.
    const existing = makeCompiler(root);
    existing.options.resolve.alias = [
      { name: "virtual:alloy-container", alias: "/stale/path.js" },
    ];
    webpackAlloy().apply(existing);
    expect(existing.options.resolve.alias).toEqual([
      { name: "virtual:alloy-container", alias: webpackCachePath(root) },
    ]);
  });
});

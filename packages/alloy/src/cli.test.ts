import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOY_VITE_PLUGIN_OPTIONS,
  type AlloyPluginOptions,
} from "./plugins/vite-plugin";
import { ALLOY_PLUGIN_OPTIONS } from "./plugins/consumer-plugin";
import {
  getAlloyOptions,
  parseGenerateArgs,
  readOptionValue,
  resolveGenerateOptions,
  runCli,
  type RunCliDependencies,
} from "./cli";

const tmpDirs: string[] = [];

function makeTmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-cli-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("alloy CLI", () => {
  it("parses generate options", () => {
    expect(
      parseGenerateArgs([
        "--root",
        "packages/app",
        "--config",
        "vite.config.ts",
        "--bundler",
        "webpack",
        "--mode",
        "development",
      ]),
    ).toEqual({
      root: "packages/app",
      configFile: "vite.config.ts",
      bundler: "webpack",
      mode: "development",
    });
  });

  it("rejects unknown bundlers", () => {
    expect(() => parseGenerateArgs(["--bundler", "parcel"])).toThrow(
      '[alloy] --bundler must be one of "vite", "webpack", "rspack", or "none".',
    );
  });

  it("requires values for options that take values", () => {
    expect(() => readOptionValue(["--root"], 0, "--root")).toThrow(
      "[alloy] --root requires a value.",
    );
  });

  it("extracts Alloy options from tagged Vite plugins", () => {
    const alloyOptions: AlloyPluginOptions = { sourceDirs: ["app"] };
    expect(getAlloyOptions({ [ALLOY_VITE_PLUGIN_OPTIONS]: alloyOptions })).toBe(
      alloyOptions,
    );
    expect(getAlloyOptions({ [ALLOY_PLUGIN_OPTIONS]: alloyOptions })).toBe(
      alloyOptions,
    );
    expect(getAlloyOptions({ name: "other-plugin" })).toBeUndefined();
    expect(getAlloyOptions(null)).toBeUndefined();
  });

  it("resolves config-free generation options", async () => {
    await expect(
      resolveGenerateOptions({
        root: "packages/examples/app-vite",
        configFile: "false",
      }),
    ).resolves.toEqual({
      root: path.resolve("packages/examples/app-vite"),
    });
  });

  it("resolves webpack config plugin options", async () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, "webpack.config.mjs"),
      `
        const options = { sourceDirs: ["app"] };
        export default { plugins: [{ [Symbol.for("alloy-di.plugin-options")]: options }] };
      `,
    );

    await expect(
      resolveGenerateOptions({ root, bundler: "webpack" }),
    ).resolves.toEqual({
      root,
      sourceDirs: ["app"],
    });
  });

  it("resolves Rspack config functions and arrays", async () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, "rspack.config.mjs"),
      `
        export default (_env, argv) => [
          { plugins: [] },
          {
            plugins: [
              { [Symbol.for("alloy-di.plugin-options")]: { sourceDirs: [argv.mode] } }
            ]
          }
        ];
      `,
    );

    await expect(
      resolveGenerateOptions({
        root,
        bundler: "rspack",
        mode: "development",
      }),
    ).resolves.toEqual({
      root,
      sourceDirs: ["development"],
    });
  });

  it("rejects unsupported webpack TypeScript config loading", async () => {
    const root = makeTmpRoot();
    fs.writeFileSync(
      path.join(root, "webpack.config.ts"),
      "export default {};",
    );

    await expect(
      resolveGenerateOptions({
        root,
        bundler: "webpack",
        configFile: "webpack.config.ts",
      }),
    ).rejects.toThrow(
      "webpack TypeScript config loading is not supported by alloy generate yet",
    );
  });

  it("throws when resolved Vite config has no Alloy plugin", async () => {
    const root = makeTmpRoot();

    await expect(resolveGenerateOptions({ root })).rejects.toThrow(
      "[alloy] Could not find alloy() in the resolved Vite plugins.",
    );
  });

  it("prints usage for help without generating", async () => {
    const log = vi.fn();
    const generate = vi.fn<RunCliDependencies["generate"]>();
    const resolveOptions =
      vi.fn<RunCliDependencies["resolveGenerateOptions"]>();

    await runCli(["--help"], {
      generate,
      resolveGenerateOptions: resolveOptions,
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("alloy generate"));
    expect(resolveOptions).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("prints usage for generate help without generating", async () => {
    const log = vi.fn();
    const generate = vi.fn<RunCliDependencies["generate"]>();
    const resolveOptions =
      vi.fn<RunCliDependencies["resolveGenerateOptions"]>();

    await runCli(["generate", "--help"], {
      generate,
      resolveGenerateOptions: resolveOptions,
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("alloy generate"));
    expect(resolveOptions).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("runs declaration generation", async () => {
    const log = vi.fn();
    const generate = vi.fn<RunCliDependencies["generate"]>(async () => ({
      root: "/project",
      declarationDir: "/project/src",
      serviceCount: 2,
      manifestCount: 0,
    }));
    const resolveOptions = vi.fn<RunCliDependencies["resolveGenerateOptions"]>(
      async (options) => ({ ...options, root: "/project" }),
    );

    await runCli(["generate", "--config", "false"], {
      generate,
      resolveGenerateOptions: resolveOptions,
      log,
    });

    expect(resolveOptions).toHaveBeenCalledWith({ configFile: "false" });
    expect(generate).toHaveBeenCalledWith({
      configFile: "false",
      root: "/project",
    });
    expect(log).toHaveBeenCalledWith(
      "[alloy] Generated declarations for 2 service(s) in /project/src.",
    );
  });

  it("rejects unknown commands", async () => {
    await expect(
      runCli(["wat"], {
        generate: async () => ({
          root: "",
          declarationDir: "",
          serviceCount: 0,
          manifestCount: 0,
        }),
        resolveGenerateOptions: async () => ({}),
        log: () => undefined,
      }),
    ).rejects.toThrow('[alloy] Unknown command "wat".');
  });
});

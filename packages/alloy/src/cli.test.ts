import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOY_VITE_PLUGIN_OPTIONS,
  type AlloyPluginOptions,
} from "./plugins/vite-plugin";
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
      ]),
    ).toEqual({
      root: "packages/app",
      configFile: "vite.config.ts",
    });
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
    expect(getAlloyOptions({ name: "other-plugin" })).toBeUndefined();
    expect(getAlloyOptions(null)).toBeUndefined();
  });

  it("resolves config-free generation options", async () => {
    await expect(
      resolveGenerateOptions({
        root: "packages/examples/app",
        configFile: "false",
      }),
    ).resolves.toEqual({
      root: path.resolve("packages/examples/app"),
    });
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

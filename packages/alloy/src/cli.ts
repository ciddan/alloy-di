#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { InlineConfig, ResolvedConfig } from "vite";
import { generate, type AlloyGenerateOptions } from "./generate";
import { ALLOY_PLUGIN_OPTIONS } from "./plugins/consumer-plugin";
import {
  ALLOY_VITE_PLUGIN_OPTIONS,
  type AlloyPluginOptions,
} from "./plugins/vite-plugin";

export type GenerateBundler = "vite" | "webpack" | "rspack" | "none";

export interface GenerateCliOptions {
  root?: string;
  configFile?: string;
  bundler?: GenerateBundler;
  mode?: string;
  help?: boolean;
}

export interface RunCliDependencies {
  generate: typeof generate;
  resolveGenerateOptions: typeof resolveGenerateOptions;
  log: (message: string) => void;
}

const defaultRunCliDependencies: RunCliDependencies = {
  generate,
  resolveGenerateOptions,
  log: (message) => console.log(message),
};

export function printUsage(log: (message: string) => void = console.log): void {
  log(`Usage:
  alloy generate [--root <dir>] [--config <file>] [--bundler <vite|webpack|rspack|none>] [--mode <mode>]

Commands:
  generate  Generate Alloy declaration files without bundling.

Options:
  --root    Project root. Defaults to the current working directory.
  --config  Bundler config file to load. Pass "false" to skip config loading.
  --bundler Config loader to use. Defaults to "vite" unless --config false is set.
  --mode    Mode passed to webpack/Rspack config functions. Defaults to "production".`);
}

export function readOptionValue(
  args: string[],
  index: number,
  optionName: string,
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`[alloy] ${optionName} requires a value.`);
  }
  return value;
}

export function parseGenerateArgs(args: string[]): GenerateCliOptions {
  const options: GenerateCliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" || arg === "-r") {
      options.root = readOptionValue(args, i, arg);
      i++;
    } else if (arg === "--config" || arg === "-c") {
      options.configFile = readOptionValue(args, i, arg);
      i++;
    } else if (arg === "--bundler" || arg === "-b") {
      const bundler = readOptionValue(args, i, arg);
      if (
        bundler !== "vite" &&
        bundler !== "webpack" &&
        bundler !== "rspack" &&
        bundler !== "none"
      ) {
        throw new Error(
          `[alloy] --bundler must be one of "vite", "webpack", "rspack", or "none".`,
        );
      }
      options.bundler = bundler;
      i++;
    } else if (arg === "--mode" || arg === "-m") {
      options.mode = readOptionValue(args, i, arg);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
      return options;
    } else {
      throw new Error(`[alloy] Unknown option "${arg}".`);
    }
  }

  return options;
}

export function getAlloyOptions(
  plugin: unknown,
): AlloyPluginOptions | undefined {
  if (!plugin || typeof plugin !== "object") {
    return undefined;
  }
  const candidate = plugin as {
    [ALLOY_PLUGIN_OPTIONS]?: AlloyPluginOptions;
    [ALLOY_VITE_PLUGIN_OPTIONS]?: AlloyPluginOptions;
  };
  return (
    candidate[ALLOY_PLUGIN_OPTIONS] ?? candidate[ALLOY_VITE_PLUGIN_OPTIONS]
  );
}

export async function resolveGenerateOptions(
  cliOptions: GenerateCliOptions,
): Promise<AlloyGenerateOptions> {
  const root = cliOptions.root ? path.resolve(cliOptions.root) : process.cwd();
  const bundler = resolveBundler(cliOptions);

  if (bundler === "none") {
    return { root };
  }

  if (bundler === "vite") {
    return resolveViteGenerateOptions(cliOptions, root);
  }

  return resolveWebpackLikeGenerateOptions(cliOptions, root, bundler);
}

function resolveBundler(cliOptions: GenerateCliOptions): GenerateBundler {
  if (cliOptions.configFile === "false") {
    return "none";
  }
  return cliOptions.bundler ?? "vite";
}

async function resolveViteGenerateOptions(
  cliOptions: GenerateCliOptions,
  root: string,
): Promise<AlloyGenerateOptions> {
  let vite: typeof import("vite");
  try {
    vite = await import("vite");
  } catch {
    throw new Error(
      "[alloy] Could not load Vite. Install vite or run with --config false and provide options programmatically.",
    );
  }

  const inlineConfig: InlineConfig = {
    root,
    configFile: cliOptions.configFile,
  };
  const config: ResolvedConfig = await vite.resolveConfig(
    inlineConfig,
    "build",
    "production",
    "production",
  );

  const alloyOptions = config.plugins
    .map((plugin) => getAlloyOptions(plugin))
    .find((options): options is AlloyPluginOptions => Boolean(options));

  if (!alloyOptions) {
    throw new Error(
      "[alloy] Could not find alloy() in the resolved Vite plugins.",
    );
  }

  return {
    ...alloyOptions,
    root: config.root,
  };
}

async function resolveWebpackLikeGenerateOptions(
  cliOptions: GenerateCliOptions,
  root: string,
  bundler: "webpack" | "rspack",
): Promise<AlloyGenerateOptions> {
  const configFile = resolveBundlerConfigFile(
    root,
    bundler,
    cliOptions.configFile,
  );
  const loadedConfig = await loadBundlerConfig(configFile, bundler);
  const configs = normalizeWebpackLikeConfigs(
    await evaluateWebpackLikeConfig(loadedConfig, cliOptions.mode),
  );

  const alloyOptions = configs
    .flatMap((config) => (Array.isArray(config.plugins) ? config.plugins : []))
    .map((plugin) => getAlloyOptions(plugin))
    .find((options): options is AlloyPluginOptions => Boolean(options));

  if (!alloyOptions) {
    throw new Error(
      `[alloy] Could not find alloy() in the resolved ${bundlerLabel(bundler)} plugins.`,
    );
  }

  return {
    ...alloyOptions,
    root,
  };
}

function resolveBundlerConfigFile(
  root: string,
  bundler: "webpack" | "rspack",
  configFile: string | undefined,
): string {
  if (configFile) {
    return path.isAbsolute(configFile)
      ? configFile
      : path.resolve(root, configFile);
  }

  for (const extension of ["js", "mjs", "cjs"]) {
    const candidate = path.resolve(root, `${bundler}.config.${extension}`);
    try {
      if (fsExists(candidate)) {
        return candidate;
      }
    } catch {
      // Try the next extension.
    }
  }

  throw new Error(
    `[alloy] Could not find ${bundlerLabel(bundler)} config. Pass --config <file> or --config false.`,
  );
}

function fsExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

async function loadBundlerConfig(
  configFile: string,
  bundler: "webpack" | "rspack",
): Promise<unknown> {
  if (/\.[cm]?ts$/i.test(configFile)) {
    throw new Error(
      `[alloy] ${bundlerLabel(bundler)} TypeScript config loading is not supported by alloy generate yet. Use a JavaScript config wrapper or pass --config false.`,
    );
  }

  try {
    const imported = await import(pathToFileURL(configFile).href);
    return imported.default ?? imported;
  } catch (error) {
    throw new Error(
      `[alloy] Could not load ${bundlerLabel(bundler)} config at ${configFile}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function evaluateWebpackLikeConfig(
  config: unknown,
  mode = "production",
): Promise<unknown> {
  if (typeof config !== "function") {
    return config;
  }

  return config(
    { mode, production: mode === "production" },
    { mode, env: { mode } },
  );
}

interface WebpackLikeConfig {
  plugins?: unknown[];
}

function normalizeWebpackLikeConfigs(config: unknown): WebpackLikeConfig[] {
  const configs = Array.isArray(config) ? config : [config];
  return configs.filter(
    (candidate): candidate is WebpackLikeConfig =>
      Boolean(candidate) && typeof candidate === "object",
  );
}

function bundlerLabel(bundler: "webpack" | "rspack"): string {
  return bundler === "rspack" ? "Rspack" : "webpack";
}

export async function runCli(
  args: string[] = process.argv.slice(2),
  deps: RunCliDependencies = defaultRunCliDependencies,
): Promise<void> {
  const [command, ...commandArgs] = args;

  if (!command || command === "--help" || command === "-h") {
    printUsage(deps.log);
    return;
  }

  if (command !== "generate") {
    throw new Error(`[alloy] Unknown command "${command}".`);
  }

  const cliOptions = parseGenerateArgs(commandArgs);
  if (cliOptions.help) {
    printUsage(deps.log);
    return;
  }
  const options = await deps.resolveGenerateOptions(cliOptions);
  const result = await deps.generate(options);
  deps.log(
    `[alloy] Generated declarations for ${result.serviceCount} service(s) in ${result.declarationDir}.`,
  );
}

function isMainModule(): boolean {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

if (isMainModule()) {
  try {
    await runCli();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

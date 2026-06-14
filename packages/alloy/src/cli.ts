#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InlineConfig, ResolvedConfig } from "vite";
import { generate, type AlloyGenerateOptions } from "./generate";
import {
  ALLOY_VITE_PLUGIN_OPTIONS,
  type AlloyPluginOptions,
} from "./plugins/vite-plugin";

export interface GenerateCliOptions {
  root?: string;
  configFile?: string;
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
  alloy generate [--root <dir>] [--config <file>]

Commands:
  generate  Generate Alloy declaration files without bundling.

Options:
  --root    Project root. Defaults to the current working directory.
  --config  Vite config file to load. Pass "false" to skip config loading.`);
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
  return (plugin as { [ALLOY_VITE_PLUGIN_OPTIONS]?: AlloyPluginOptions })[
    ALLOY_VITE_PLUGIN_OPTIONS
  ];
}

export async function resolveGenerateOptions(
  cliOptions: GenerateCliOptions,
): Promise<AlloyGenerateOptions> {
  const root = cliOptions.root ? path.resolve(cliOptions.root) : process.cwd();

  if (cliOptions.configFile === "false") {
    return { root };
  }

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

#!/usr/bin/env node
import path from "node:path";
import type { InlineConfig, ResolvedConfig } from "vite";
import { generate, type AlloyGenerateOptions } from "./generate";
import {
  ALLOY_VITE_PLUGIN_OPTIONS,
  type AlloyPluginOptions,
} from "./plugins/vite-plugin";

interface GenerateCliOptions {
  root?: string;
  configFile?: string;
}

function printUsage(): void {
  console.log(`Usage:
  alloy generate [--root <dir>] [--config <file>]

Commands:
  generate  Generate Alloy declaration files without bundling.

Options:
  --root    Project root. Defaults to the current working directory.
  --config  Vite config file to load. Pass "false" to skip config loading.`);
}

function readOptionValue(
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

function parseGenerateArgs(args: string[]): GenerateCliOptions {
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
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`[alloy] Unknown option "${arg}".`);
    }
  }

  return options;
}

function getAlloyOptions(plugin: unknown): AlloyPluginOptions | undefined {
  if (!plugin || typeof plugin !== "object") {
    return undefined;
  }
  return (plugin as { [ALLOY_VITE_PLUGIN_OPTIONS]?: AlloyPluginOptions })[
    ALLOY_VITE_PLUGIN_OPTIONS
  ];
}

async function resolveGenerateOptions(
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

async function run(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command !== "generate") {
    throw new Error(`[alloy] Unknown command "${command}".`);
  }

  const cliOptions = parseGenerateArgs(args);
  const options = await resolveGenerateOptions(cliOptions);
  const result = await generate(options);
  console.log(
    `[alloy] Generated declarations for ${result.serviceCount} service(s) in ${result.declarationDir}.`,
  );
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import path from "node:path";
import {
  ALLOY_PLUGIN_OPTIONS,
  createConsumerPluginContext,
  type AlloyPluginOptions,
} from "./consumer-plugin";

interface TapHook {
  tap?(name: string, handler: (...args: unknown[]) => unknown): void;
  tapPromise?(
    name: string,
    handler: (...args: unknown[]) => Promise<unknown>,
  ): void;
}

interface WebpackLikeCompiler {
  context?: string;
  options?: {
    context?: string;
    mode?: string;
    resolve?: {
      alias?:
        | Record<string, string | false | string[]>
        | { name?: string; alias?: string | false | string[] }[];
    };
  };
  hooks?: {
    beforeRun?: TapHook;
    run?: TapHook;
    watchRun?: TapHook;
    beforeCompile?: TapHook;
    thisCompilation?: TapHook;
    normalModuleFactory?: TapHook;
  };
}

interface WebpackLikeCompilation {
  fileDependencies?: Set<string> | { add(file: string): void };
  contextDependencies?: Set<string> | { add(file: string): void };
}

interface WebpackLikeNormalModuleFactory {
  hooks?: {
    beforeResolve?: TapHook;
  };
}

interface ResolveRequest {
  request?: string;
}

export interface AlloyWebpackLikePlugin {
  readonly name: string;
  readonly [ALLOY_PLUGIN_OPTIONS]: AlloyPluginOptions;
  apply(compiler: WebpackLikeCompiler): void;
}

export interface CreateWebpackLikePluginOptions {
  name: string;
  cacheFileName: string;
}

function addDependency(
  deps: WebpackLikeCompilation["fileDependencies"],
  file: string,
): void {
  deps?.add(file);
}

function addContextDependency(
  deps: WebpackLikeCompilation["contextDependencies"],
  dir: string,
): void {
  deps?.add(dir);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isWebpackLikeNormalModuleFactory(
  value: unknown,
): value is WebpackLikeNormalModuleFactory {
  return isObject(value) && isObject(value.hooks);
}

function isResolveRequest(value: unknown): value is ResolveRequest {
  return value === undefined || isObject(value);
}

function isWebpackLikeCompilation(
  value: unknown,
): value is WebpackLikeCompilation {
  return isObject(value);
}

export function createWebpackLikeAlloyPlugin(
  options: AlloyPluginOptions,
  pluginOptions: CreateWebpackLikePluginOptions,
): AlloyWebpackLikePlugin {
  const context = createConsumerPluginContext(options);
  let cacheFilePath = "";

  async function writeContainer(): Promise<void> {
    context.buildStart();
    await context.writeContainerCache(cacheFilePath);
  }

  function configureAlias(compiler: WebpackLikeCompiler): void {
    compiler.options ??= {};
    compiler.options.resolve ??= {};
    const alias = compiler.options.resolve.alias;

    if (Array.isArray(alias)) {
      const existing = alias.find(
        (entry) => entry.name === context.virtualModuleId,
      );
      if (existing) {
        existing.alias = cacheFilePath;
      } else {
        alias.push({ name: context.virtualModuleId, alias: cacheFilePath });
      }
      return;
    }

    compiler.options.resolve.alias = {
      ...alias,
      [context.virtualModuleId]: cacheFilePath,
    };
  }

  function configureVirtualResolve(compiler: WebpackLikeCompiler): void {
    compiler.hooks?.normalModuleFactory?.tap?.(
      pluginOptions.name,
      (factory: unknown) => {
        if (!isWebpackLikeNormalModuleFactory(factory)) {
          return;
        }

        factory.hooks?.beforeResolve?.tap?.(
          pluginOptions.name,
          (request: unknown) => {
            if (!isResolveRequest(request)) {
              return;
            }

            const resolveRequest = request;
            if (resolveRequest?.request === context.virtualModuleId) {
              resolveRequest.request = cacheFilePath;
            }
          },
        );
      },
    );
  }

  function configureLifecycleHooks(compiler: WebpackLikeCompiler): void {
    const tapCompileHook = (hook: TapHook | undefined): void => {
      hook?.tapPromise?.(pluginOptions.name, async () => {
        await writeContainer();
      });
    };

    tapCompileHook(compiler.hooks?.beforeRun);
    tapCompileHook(compiler.hooks?.run);
    tapCompileHook(compiler.hooks?.watchRun);
    tapCompileHook(compiler.hooks?.beforeCompile);

    compiler.hooks?.thisCompilation?.tap?.(
      pluginOptions.name,
      (compilation: unknown) => {
        if (!isWebpackLikeCompilation(compilation)) {
          return;
        }

        addDependency(compilation.fileDependencies, cacheFilePath);
        for (const watchFile of context.getWatchFiles()) {
          addDependency(compilation.fileDependencies, watchFile);
        }
        for (const watchRoot of context.getWatchDirectories()) {
          addContextDependency(compilation.contextDependencies, watchRoot);
        }
      },
    );
  }

  return {
    name: pluginOptions.name,
    [ALLOY_PLUGIN_OPTIONS]: options,
    apply(compiler: WebpackLikeCompiler): void {
      const root =
        compiler.options?.context ?? compiler.context ?? process.cwd();
      const isDevMode = compiler.options?.mode
        ? compiler.options.mode !== "production"
        : undefined;
      context.configure({ root, isDevMode });
      cacheFilePath = path.resolve(
        root,
        "node_modules/.cache/alloy-di",
        pluginOptions.cacheFileName,
      );

      configureAlias(compiler);
      configureVirtualResolve(compiler);
      configureLifecycleHooks(compiler);
    },
  };
}

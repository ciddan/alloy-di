import type { Plugin } from "vite";
import {
  ALLOY_PLUGIN_OPTIONS,
  createConsumerPluginContext,
  isAlloyDiscoverableFile,
  type AlloyPluginOptions,
} from "../consumer-plugin";

export type {
  AlloyPluginOptions,
  AlloyMermaidVisualizerOptions,
  AlloyVisualizationOptions,
} from "../consumer-plugin";
import { invalidateContainerModule } from "./module-invalidation";

export const ALLOY_VITE_PLUGIN_OPTIONS = Symbol.for(
  "alloy-di.vite-plugin-options",
);

export interface AlloyVitePlugin extends Plugin {
  [ALLOY_VITE_PLUGIN_OPTIONS]: AlloyPluginOptions;
  [ALLOY_PLUGIN_OPTIONS]: AlloyPluginOptions;
}

/**
 * Creates the Alloy Vite plugin that statically discovers injectable classes
 * and exposes them through a virtual container module at build time.
 */
export function alloy(options: AlloyPluginOptions = {}): Plugin {
  const context = createConsumerPluginContext(options);

  const plugin: AlloyVitePlugin = {
    name: "vite-plugin-alloy",
    enforce: "pre",
    [ALLOY_VITE_PLUGIN_OPTIONS]: options,
    [ALLOY_PLUGIN_OPTIONS]: options,

    configResolved(config) {
      context.configure({
        root: config.root ?? process.cwd(),
        isDevMode: !config.isProduction,
      });
    },

    resolveId: {
      filter: { id: { include: [/^virtual:alloy-container$/] } },
      handler(id) {
        if (id === context.virtualModuleId) {
          return context.resolvedVirtualModuleId;
        }
        return undefined;
      },
    },

    // Discovery only — the code is never modified, so the handler returns
    // null and the filter keeps non-TS modules and node_modules (skipped for
    // performance & determinism; internal libraries should provide manifests
    // instead) from crossing the Rust/JS boundary under Rolldown.
    transform: {
      filter: {
        id: {
          include: [/\.tsx?$/i],
          exclude: [/\.d\.ts$/i, /node_modules/],
        },
      },
      handler(code, id) {
        context.processTransform(code, id);
        return null;
      },
    },

    async hotUpdate(ctx) {
      if (this.environment.name !== "client") {
        return;
      }

      const { file } = ctx;

      if (!isAlloyDiscoverableFile(file)) {
        return;
      }

      let discoveryChanged: boolean;
      if (ctx.type === "delete") {
        discoveryChanged = context.removeFile(file);
      } else {
        let code: string;
        try {
          code = await ctx.read();
        } catch {
          return;
        }

        discoveryChanged = context.processFileUpdate(file, code);
      }

      if (!discoveryChanged) {
        return;
      }

      // The discovered service graph changed. Regenerate the container by
      // invalidating it in every environment, then force a full reload so the
      // browser re-fetches the new wiring. The DI graph cannot be hot-swapped.
      invalidateContainerModule(ctx.server, context.resolvedVirtualModuleId);
      this.environment.hot.send({ type: "full-reload" });
      return [];
    },

    buildStart() {
      context.buildStart((file) => this.addWatchFile(file));
    },

    load: {
      // oxlint-disable-next-line no-control-regex -- \0 is Rollup's resolved virtual module prefix
      filter: { id: { include: [/^\0virtual:alloy-container$/] } },
      async handler(id) {
        if (id !== context.resolvedVirtualModuleId) {
          return undefined;
        }

        return context.loadContainer();
      },
    },
  };

  return plugin;
}

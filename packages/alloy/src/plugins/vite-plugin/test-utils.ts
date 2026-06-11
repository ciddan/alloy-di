/* oxlint-disable no-unsafe-type-assertion */
import type { Plugin } from "vite";

/**
 * Helpers for invoking the plugin's hooks from unit tests.
 *
 * The plugin declares its hooks in object form (`{ filter, handler }`) so
 * Rolldown can evaluate the filters natively. These helpers mirror what Vite
 * does at runtime: evaluate the id filter first, then call the handler, so
 * tests exercise the same skip behavior as production.
 */

interface IdFilter {
  include?: RegExp[];
  exclude?: RegExp[];
}

interface ObjectHook {
  filter?: { id?: IdFilter };
  handler: (...args: unknown[]) => unknown;
}

type AnyHook = ObjectHook | ((...args: unknown[]) => unknown);

function idFilterMatches(hook: AnyHook, id: string): boolean {
  if (typeof hook === "function" || !hook.filter?.id) {
    return true;
  }
  const { include, exclude } = hook.filter.id;
  if (exclude?.some((pattern) => pattern.test(id))) {
    return false;
  }
  if (include && !include.some((pattern) => pattern.test(id))) {
    return false;
  }
  return true;
}

function getHandler(hook: AnyHook): (...args: unknown[]) => unknown {
  return typeof hook === "function" ? hook : hook.handler;
}

function invoke(
  hook: unknown,
  id: string,
  args: unknown[],
  context: unknown = {},
): unknown {
  const anyHook = hook as AnyHook;
  if (!idFilterMatches(anyHook, id)) {
    return null;
  }
  return getHandler(anyHook).apply(context, args);
}

export function applyConfigResolved(
  plugin: Plugin,
  config: Record<string, unknown>,
): unknown {
  const hook = plugin.configResolved as AnyHook;
  return getHandler(hook).call({}, config);
}

export function applyBuildStart(plugin: Plugin): unknown {
  const hook = plugin.buildStart as AnyHook;
  return getHandler(hook).call({ addWatchFile: () => undefined });
}

export function resolveVirtualId(plugin: Plugin, id: string): unknown {
  return invoke(plugin.resolveId, id, [id]);
}

export function applyTransform(
  plugin: Plugin,
  code: string,
  id: string,
): unknown {
  return invoke(plugin.transform, id, [code, id]);
}

export async function loadContainer(
  plugin: Plugin,
  id: string,
): Promise<string | undefined> {
  const result = await invoke(plugin.load, id, [id]);
  if (result === null || result === undefined) {
    return undefined;
  }
  if (typeof result === "string") {
    return result;
  }
  return (result as { code: string }).code;
}

const RESOLVED_VIRTUAL_ID = "\0virtual:alloy-container";

export interface HotUpdateContextInit {
  file: string;
  /** Defaults to "update". */
  type?: "create" | "update" | "delete";
  /** Source returned by `ctx.read()` for create/update events. */
  code?: string;
  modules?: unknown[];
  /** Whether the container module exists in the graph (default true). */
  hasContainerModule?: boolean;
}

export interface HotUpdateResult {
  /** The hook's return value (`[]` when it forces a reload, else undefined). */
  result: unknown;
  /** Module ids passed to `invalidateModule`. */
  invalidatedIds: string[];
  /** Payloads sent via `environment.hot.send`. */
  sent: unknown[];
}

/**
 * Invokes the plugin's `hotUpdate` hook with a fake dev-server context: a
 * single client environment whose module graph contains the resolved container
 * module, plus spies for `invalidateModule` and `hot.send`.
 */
export async function applyHotUpdate(
  plugin: Plugin,
  init: HotUpdateContextInit,
): Promise<HotUpdateResult> {
  const invalidatedIds: string[] = [];
  const sent: unknown[] = [];
  const hasContainer = init.hasContainerModule ?? true;
  const containerModule = { id: RESOLVED_VIRTUAL_ID };

  const environment = {
    name: "client",
    moduleGraph: {
      getModuleById(id: string) {
        return hasContainer && id === RESOLVED_VIRTUAL_ID
          ? containerModule
          : undefined;
      },
      invalidateModule(mod: { id: string }) {
        invalidatedIds.push(mod.id);
      },
    },
    hot: {
      send(payload: unknown) {
        sent.push(payload);
      },
    },
  };

  const ctx = {
    file: init.file,
    type: init.type ?? "update",
    timestamp: Date.now(),
    modules: init.modules ?? [],
    read: () => init.code ?? "",
    server: { environments: { client: environment } },
  };

  const hook = plugin.hotUpdate as unknown as AnyHook;
  const result = await getHandler(hook).call({ environment }, ctx);
  return { result, invalidatedIds, sent };
}

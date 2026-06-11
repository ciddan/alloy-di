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

export interface HotUpdateContextInit {
  file: string;
  modules?: unknown[];
  type?: "create" | "update" | "delete";
  environments?: Record<string, unknown>;
}

export function applyHotUpdate(
  plugin: Plugin,
  init: HotUpdateContextInit,
): unknown {
  const hook = plugin.hotUpdate as unknown as AnyHook;
  const ctx = {
    file: init.file,
    modules: init.modules ?? [],
    type: init.type ?? "update",
    server: { environments: init.environments ?? {} },
  };
  return getHandler(hook).call({ environment: { name: "client" } }, ctx);
}

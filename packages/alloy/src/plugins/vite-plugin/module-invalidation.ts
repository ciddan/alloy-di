import type { ViteDevServer } from "vite";

/**
 * Invalidate the generated container module in every environment's module
 * graph so its `load` hook re-runs and regenerates from current discovery.
 */
export function invalidateContainerModule(
  server: ViteDevServer,
  resolvedVirtualModuleId: string,
): void {
  for (const environment of Object.values(server.environments)) {
    const mod = environment.moduleGraph.getModuleById(resolvedVirtualModuleId);
    if (mod) {
      environment.moduleGraph.invalidateModule(mod);
    }
  }
}

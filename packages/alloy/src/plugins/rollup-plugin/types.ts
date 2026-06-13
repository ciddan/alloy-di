import type { BuildMode } from "./build-utils";
import type { ManifestServiceDescriptorV2 } from "../core/types";

/** Manifest emitted by the rollup/rolldown plugin (schema v2). */
export interface AlloyManifestV2 {
  schemaVersion: 2;
  packageName: string;
  buildMode: BuildMode;
  services: ManifestServiceDescriptorV2[];
  /** Optional provider module import specifiers (internal library-provided). */
  providers?: string[];
  diagnostics?: {
    barrelFallback?: boolean;
    duplicateServices?: string[];
    missingExports?: string[];
  };
}

export interface AlloyManifestPluginOptions {
  /** Optional override for emitted filename. Defaults to 'alloy.manifest.mjs'. */
  fileName?: string;
  /** Relative or absolute path to package.json if not at cwd root. */
  packageJsonPath?: string;
  /**
   * Optional list of provider module source paths to include in the manifest.
   * These should be file paths within the library (e.g., 'src/providers.ts').
   * In `preserveModules` builds, import specifiers will be derived and emitted
   * so consumer apps can import and apply them automatically.
   */
  providers?: string[];
}

/**
 * Minimal Rollup/Rolldown plugin surface used by the Alloy manifest plugin.
 */
export interface MinimalRollupPlugin {
  name: string;
  transform?(code: string, id: string): unknown;
  generateBundle?(outputOptions: unknown): void;
  emitFile?(file: { type: "asset"; fileName: string; source: string }): void;
}

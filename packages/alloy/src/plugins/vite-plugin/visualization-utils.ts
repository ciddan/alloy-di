import fs from "node:fs";
import path from "node:path";
import type { MermaidDiagramOptions } from "./visualizer";

export const DEFAULT_MERMAID_FILENAME = "alloy-di.mmd";

export interface AlloyMermaidVisualizerOptions extends MermaidDiagramOptions {
  outputPath?: string;
}

export interface AlloyVisualizationOptions {
  /**
   * Configure Mermaid diagram emission. Use `true` for defaults or provide
   * overrides for layout, colors, or output path.
   */
  mermaid?: boolean | AlloyMermaidVisualizerOptions;
}

export interface ResolvedVisualizationOptions {
  outputPath: string;
  mermaidOptions?: MermaidDiagramOptions;
}

export function resolveVisualizationOptions(
  input: boolean | AlloyVisualizationOptions | undefined,
  projectRoot: string,
): ResolvedVisualizationOptions | null {
  if (!input) {
    return null;
  }
  if (typeof input === "boolean") {
    return {
      outputPath: path.resolve(projectRoot, DEFAULT_MERMAID_FILENAME),
      mermaidOptions: undefined,
    };
  }
  const mermaidConfig = input.mermaid;
  if (!mermaidConfig) {
    return null;
  }
  if (mermaidConfig === true) {
    return {
      outputPath: path.resolve(projectRoot, DEFAULT_MERMAID_FILENAME),
      mermaidOptions: undefined,
    };
  }
  const { outputPath, ...rest } = mermaidConfig;
  const resolvedOutputPath = path.resolve(
    projectRoot,
    outputPath ?? DEFAULT_MERMAID_FILENAME,
  );
  const mermaidOptions =
    Object.keys(rest).length > 0 ? (rest as MermaidDiagramOptions) : undefined;
  return {
    outputPath: resolvedOutputPath,
    mermaidOptions,
  };
}

export function ensureDirectoryForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

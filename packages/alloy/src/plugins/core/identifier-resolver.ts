import type { DiscoveredMeta } from "./types";
import { createAliasName } from "./utils";

export class IdentifierResolver {
  private readonly counts: Map<string, number>;

  constructor(metas: Iterable<Pick<DiscoveredMeta, "className" | "filePath">>) {
    this.counts = new Map();
    for (const meta of metas) {
      const current = this.counts.get(meta.className) ?? 0;
      this.counts.set(meta.className, current + 1);
    }
  }

  public count(className: string): number {
    return this.counts.get(className) ?? 0;
  }

  public resolve(className: string, importPath: string): string {
    return this.count(className) > 1
      ? createAliasName(className, importPath)
      : className;
  }
}

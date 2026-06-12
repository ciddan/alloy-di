import { describe, expect, it } from "vitest";
import { createDiscoveryStore } from "./discovery-store";

const serviceSource = `
  import { Injectable } from "alloy-di/runtime";

  @Injectable()
  export class Svc {}
`;

describe("discovery store change detection (issue #22)", () => {
  it("serves identical content from the cache without re-scanning", () => {
    const store = createDiscoveryStore();
    const first = store.updateFile("/src/svc.ts", serviceSource);
    expect(first.metas).toHaveLength(1);

    const second = store.updateFile("/src/svc.ts", serviceSource);

    // Same array reference: a re-scan would have produced fresh meta
    // objects, so identity proves the cached result was returned.
    expect(second.metas).toBe(first.metas);
    expect(second.previousMetas).toBe(first.metas);
  });

  it("re-scans when content changes", () => {
    const store = createDiscoveryStore();
    store.updateFile("/src/svc.ts", serviceSource);

    const changed = store.updateFile(
      "/src/svc.ts",
      serviceSource.replace("class Svc", "class Renamed"),
    );
    expect(changed.metas.map((m) => m.className)).toEqual(["Renamed"]);
  });

  it("re-scans a re-added file after removeFile", () => {
    const store = createDiscoveryStore();
    store.updateFile("/src/svc.ts", serviceSource);
    store.removeFile("/src/svc.ts");

    // A stale content hash here would serve an empty cached result and
    // silently drop the service.
    const reAdded = store.updateFile("/src/svc.ts", serviceSource);
    expect(reAdded.metas).toHaveLength(1);
  });

  it("re-scans after clear()", () => {
    const store = createDiscoveryStore();
    store.updateFile("/src/svc.ts", serviceSource);
    store.clear();

    const reAdded = store.updateFile("/src/svc.ts", serviceSource);
    expect(reAdded.metas).toHaveLength(1);
  });
});

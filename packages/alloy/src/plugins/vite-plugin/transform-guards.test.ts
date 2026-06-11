import { describe, it, expect } from "vitest";
import { alloy } from "./index";
import { applyTransform, loadContainer } from "./test-utils";

const injectableSource = `
  import { Injectable } from 'alloy-di/runtime';
  @Injectable()
  export class GuardedService {}
`;

/** Returns true when a file at `id` ends up registered in the container. */
async function discovers(id: string): Promise<boolean> {
  const plugin = alloy();
  applyTransform(plugin, injectableSource, id);
  const generated = await loadContainer(plugin, "\0virtual:alloy-container");
  return /GuardedService/.test(generated ?? "");
}

/** Guard against regressions in transform filtering conditions */
describe("transform guards", () => {
  it("discovers services in TS source files", async () => {
    expect(await discovers("/src/guarded-service.ts")).toBe(true);
  });

  it("skips non-TS files", async () => {
    expect(await discovers("/file.js")).toBe(false);
  });

  it("skips declaration files", async () => {
    expect(await discovers("/types.d.ts")).toBe(false);
  });

  it("always skips node_modules files (manifest ingestion only)", async () => {
    expect(await discovers("/node_modules/otherpkg/a.ts")).toBe(false);
    expect(await discovers("/node_modules/@acme/lib/a.ts")).toBe(false);
  });
});

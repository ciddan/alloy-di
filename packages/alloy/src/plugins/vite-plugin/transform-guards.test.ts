import { describe, it, expect } from "vitest";
import { alloy } from "./index";

/** Guard against regressions in transform filtering conditions */
describe("transform guards", () => {
  it("skips non-TS files", () => {
    const plugin = alloy();
    // @ts-expect-error testing transform
    const res = plugin.transform("code", "/file.js");
    expect(res).toBeNull();
  });

  it("skips declaration files", () => {
    const plugin = alloy();
    // @ts-expect-error testing transform
    const res = plugin.transform("code", "/types.d.ts");
    expect(res).toBeNull();
  });

  it("always skips node_modules files (manifest ingestion only)", () => {
    const plugin = alloy();
    // @ts-expect-error testing transform
    const res = plugin.transform("code", "/node_modules/otherpkg/a.ts");
    expect(res).toBeNull();
    // @ts-expect-error testing transform
    const res2 = plugin.transform("code", "/node_modules/@acme/lib/a.ts");
    expect(res2).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { parseExportedNames } from "./barrel-exports";

describe("parseExportedNames", () => {
  it("returns an empty set when sources are absent", () => {
    expect(parseExportedNames(undefined).size).toBe(0);
  });

  it("collects class, const, function and re-export names from the barrel", () => {
    const sources = new Map<string, string>([
      [
        "/proj/src/index.ts",
        `
          export class Foo {}
          export const bar = 1;
          export function baz() {}
          export { Qux, Quux } from './q';
        `,
      ],
      ["/proj/src/foo.ts", "export class Foo {}"],
    ]);
    expect([...parseExportedNames(sources)].toSorted()).toEqual(
      ["Foo", "Quux", "Qux", "bar", "baz"].toSorted(),
    );
  });

  it("captures destructuring exports (object, array, rename, rest)", () => {
    const sources = new Map<string, string>([
      [
        "/proj/src/index.ts",
        `
          export const { Foo, Bar: Renamed } = make();
          export const [first, , third] = tuple();
          export const { nested: { deep }, ...rest } = make();
        `,
      ],
    ]);
    expect([...parseExportedNames(sources)].toSorted()).toEqual(
      ["Foo", "Renamed", "deep", "first", "rest", "third"].toSorted(),
    );
  });

  it("returns empty when there is no barrel index", () => {
    const sources = new Map([["/proj/src/foo.ts", "export class Foo {}"]]);
    expect(parseExportedNames(sources).size).toBe(0);
  });

  it("prefers /src/index over a root index", () => {
    const sources = new Map([
      ["/proj/index.ts", "export class Root {}"],
      ["/proj/src/index.ts", "export class SrcLevel {}"],
    ]);
    expect([...parseExportedNames(sources)]).toEqual(["SrcLevel"]);
  });
});

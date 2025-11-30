import { describe, it, expect } from "vitest";
import { IdentifierResolver } from "./identifier-resolver";
import type { DiscoveredMeta } from "./types";
import { createAliasName } from "./utils";
import { ServiceScope } from "../../lib/scope";

const makeMeta = (className: string, filePath: string): DiscoveredMeta => ({
  className,
  filePath,
  metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
});

describe("IdentifierResolver", () => {
  it("returns class name when unique", () => {
    const metas = [
      makeMeta("Foo", "/src/foo.ts"),
      makeMeta("Bar", "/src/bar.ts"),
    ];
    const resolver = new IdentifierResolver(metas);
    expect(resolver.resolve("Foo", "/src/foo.ts")).toBe("Foo");
    expect(resolver.count("Foo")).toBe(1);
  });

  it("creates aliases for duplicate names", () => {
    const metas = [
      makeMeta("Foo", "/src/foo.ts"),
      makeMeta("Foo", "/src/nested/foo.ts"),
    ];
    const resolver = new IdentifierResolver(metas);
    expect(resolver.count("Foo")).toBe(2);
    expect(resolver.resolve("Foo", "/src/foo.ts")).toBe(
      createAliasName("Foo", "/src/foo.ts"),
    );
    expect(resolver.resolve("Foo", "/src/nested/foo.ts")).toBe(
      createAliasName("Foo", "/src/nested/foo.ts"),
    );
  });
});

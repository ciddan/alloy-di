import { describe, expect, it } from "vitest";
import {
  getAncestorScopes,
  isDependencyAllowed,
  validateScopeStability,
  validateScopesConfig,
  type AlloyScopesConfig,
} from "./scopes-validation";
import type { DiscoveredMeta } from "./types";

const HIERARCHY: AlloyScopesConfig = {
  session: { parent: "singleton" },
  request: { parent: "session" },
};

function service(
  className: string,
  scope: string,
  deps: { name: string; path: string; originalName?: string }[] = [],
): DiscoveredMeta {
  return {
    className,
    filePath: `/src/${className}.ts`,
    metadata: {
      scope,
      dependencies: deps.map((d) => ({
        expression: d.name,
        referencedIdentifiers: [d.name],
        isLazy: false,
      })),
    },
    referencedImports: deps.map((d) => ({
      name: d.name,
      path: d.path,
      originalName: d.originalName ?? d.name,
    })),
  };
}

describe("validateScopesConfig", () => {
  it("accepts an empty or undefined config", () => {
    expect(() => validateScopesConfig(undefined)).not.toThrow();
    expect(() => validateScopesConfig({})).not.toThrow();
  });

  it("accepts a valid hierarchy", () => {
    expect(() => validateScopesConfig(HIERARCHY)).not.toThrow();
  });

  it("rejects redeclaring a built-in lifecycle", () => {
    expect(() =>
      validateScopesConfig({ singleton: { parent: "singleton" } }),
    ).toThrow(/built-in lifecycle/);
    expect(() =>
      validateScopesConfig({ transient: { parent: "singleton" } }),
    ).toThrow(/built-in lifecycle/);
  });

  it("rejects 'transient' as a parent", () => {
    expect(() =>
      validateScopesConfig({ request: { parent: "transient" } }),
    ).toThrow(/transient.*never be a parent/);
  });

  it("rejects an unknown parent", () => {
    expect(() =>
      validateScopesConfig({ request: { parent: "sesion" } }),
    ).toThrow(/unknown parent 'sesion'/);
  });

  it("detects a direct cycle", () => {
    expect(() => validateScopesConfig({ a: { parent: "a" } })).toThrow(
      /Cyclic scope hierarchy/,
    );
  });

  it("detects an indirect cycle", () => {
    expect(() =>
      validateScopesConfig({
        a: { parent: "b" },
        b: { parent: "a" },
      }),
    ).toThrow(/Cyclic scope hierarchy/);
  });
});

describe("getAncestorScopes", () => {
  it("returns no ancestors for built-ins", () => {
    expect(getAncestorScopes("singleton", HIERARCHY)).toEqual([]);
    expect(getAncestorScopes("transient", HIERARCHY)).toEqual([]);
  });

  it("walks the parent chain to the root", () => {
    expect(getAncestorScopes("request", HIERARCHY)).toEqual([
      "session",
      "singleton",
    ]);
    expect(getAncestorScopes("session", HIERARCHY)).toEqual(["singleton"]);
  });
});

describe("isDependencyAllowed", () => {
  it("allows depending on an equal or longer-lived scope", () => {
    expect(isDependencyAllowed("request", "request", HIERARCHY)).toBe(true);
    expect(isDependencyAllowed("request", "session", HIERARCHY)).toBe(true);
    expect(isDependencyAllowed("request", "singleton", HIERARCHY)).toBe(true);
    expect(isDependencyAllowed("session", "singleton", HIERARCHY)).toBe(true);
  });

  it("lets transient depend on anything", () => {
    expect(isDependencyAllowed("transient", "request", HIERARCHY)).toBe(true);
    expect(isDependencyAllowed("transient", "singleton", HIERARCHY)).toBe(true);
  });

  it("rejects depending on a shorter-lived scope", () => {
    expect(isDependencyAllowed("session", "request", HIERARCHY)).toBe(false);
    expect(isDependencyAllowed("singleton", "request", HIERARCHY)).toBe(false);
    expect(isDependencyAllowed("singleton", "session", HIERARCHY)).toBe(false);
  });

  it("treats transient as the leaf — nothing longer-lived may capture it", () => {
    expect(isDependencyAllowed("singleton", "transient", HIERARCHY)).toBe(
      false,
    );
    expect(isDependencyAllowed("session", "transient", HIERARCHY)).toBe(false);
  });
});

describe("validateScopeStability", () => {
  it("passes a graph that respects the lattice", () => {
    const metas = [
      service("UserSession", "session", [{ name: "Config", path: "./Config" }]),
      service("Config", "singleton"),
      service("RequestLogger", "request", [
        { name: "UserSession", path: "./UserSession" },
      ]),
    ];
    expect(() => validateScopeStability(metas, HIERARCHY)).not.toThrow();
  });

  it("flags a singleton capturing a request-scoped dependency", () => {
    const metas = [
      service("AppService", "singleton", [
        { name: "RequestLogger", path: "./RequestLogger" },
      ]),
      service("RequestLogger", "request"),
    ];
    expect(() => validateScopeStability(metas, HIERARCHY)).toThrow(
      /'AppService' \(singleton\) depends on 'RequestLogger' \(request\)/,
    );
  });

  it("flags a singleton capturing a transient dependency", () => {
    const metas = [
      service("AppService", "singleton", [
        { name: "Helper", path: "./Helper" },
      ]),
      service("Helper", "transient"),
    ];
    expect(() => validateScopeStability(metas, HIERARCHY)).toThrow(
      /stability violation/,
    );
  });

  it("flags services declaring an undeclared scope", () => {
    const metas = [service("Mystery", "sesion")];
    expect(() => validateScopeStability(metas, HIERARCHY)).toThrow(
      /unknown scope 'sesion'/,
    );
  });

  it("allows a transient to depend on a request-scoped service", () => {
    const metas = [
      service("Helper", "transient", [
        { name: "RequestLogger", path: "./RequestLogger" },
      ]),
      service("RequestLogger", "request"),
    ];
    expect(() => validateScopeStability(metas, HIERARCHY)).not.toThrow();
  });
});

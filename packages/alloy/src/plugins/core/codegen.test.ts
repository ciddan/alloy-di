import { describe, it, expect } from "vitest";
import {
  GENERATED_FILE_HEADER,
  generateContainerModule,
  generateContainerTypeDefinition,
  generateScopeAugmentationDefinition,
  generateManifestTypeDefinition,
  __codegenInternals,
  type ResolvedRegistration,
  type ResolvedDependencyImport,
} from "./codegen";
import { ServiceScope } from "../../lib/scope";
import type { ServiceMetadata } from "./types";

const createRegistration = (
  overrides: Partial<ResolvedRegistration> & {
    metadata?: Partial<ServiceMetadata>;
  } = {},
): ResolvedRegistration => {
  const metadata: ServiceMetadata = {
    scope: overrides.metadata?.scope ?? ServiceScope.TRANSIENT,
    dependencies: overrides.metadata?.dependencies ?? [],
    factory: overrides.metadata?.factory,
  };
  return {
    className: overrides.className ?? "Svc",
    filePath: overrides.filePath ?? "/svc.ts",
    metadata,
    importName: overrides.importName ?? "Svc",
    isFactoryLazy: overrides.isFactoryLazy ?? false,
    identifierConst: overrides.identifierConst ?? "SvcIdentifier",
    exportKey: overrides.exportKey ?? "Svc",
    symbolDescription: overrides.symbolDescription ?? "alloy:/svc.ts#Svc",
    optionsText: overrides.optionsText ?? "{}",
    referencedImports: overrides.referencedImports ?? [],
  } as ResolvedRegistration;
};

describe("codegen import path handling", () => {
  it("keeps bare specifiers unnormalized", () => {
    const metas = [
      {
        className: "Svc",
        filePath: "@scope/pkg/svc",
        metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toMatch("import { Svc } from '@scope/pkg/svc'");
  });
  it("normalizes absolute paths", () => {
    const metas = [
      {
        className: "Svc",
        filePath: "/home/user/project/src/svc.ts",
        metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toMatch("import { Svc } from '/home/user/project/src/svc.ts'");
  });
});

describe("generated declaration file headers", () => {
  it("prepends the volatility notice to the container d.ts", () => {
    const dts = generateContainerTypeDefinition([], (p) => p);
    expect(dts.startsWith("/**")).toBe(true);
    expect(dts).toContain(GENERATED_FILE_HEADER);
  });

  it("prepends the volatility notice to the manifests d.ts", () => {
    const dts = generateManifestTypeDefinition([
      { packageName: "@scope/lib", services: [{ exportName: "Svc" }] },
    ]);
    expect(dts.startsWith("/**")).toBe(true);
    expect(dts).toContain(GENERATED_FILE_HEADER);
  });
});

describe("generateManifestTypeDefinition", () => {
  it("generates ambient declarations for manifests and identifiers", () => {
    const manifests = [
      {
        packageName: "@scope/lib-a",
        services: [{ exportName: "ServiceA" }, { exportName: "ServiceB" }],
      },
      {
        packageName: "@scope/lib-b",
        services: [{ exportName: "ServiceC" }],
      },
    ];

    const code = generateManifestTypeDefinition(manifests);

    // Check generic manifest declaration
    expect(code).toContain('declare module "@scope/lib-a/manifest"');
    expect(code).toContain("export const manifest: LibraryManifest;");

    // Check identifiers declaration
    expect(code).toContain('declare module "@scope/lib-a/service-identifiers"');
    expect(code).toContain(
      "export const ServiceAIdentifier: ServiceIdentifier;",
    );
    expect(code).toContain(
      "export const ServiceBIdentifier: ServiceIdentifier;",
    );

    // Check second package
    expect(code).toContain('declare module "@scope/lib-b/manifest"');
    expect(code).toContain('declare module "@scope/lib-b/service-identifiers"');
    expect(code).toContain(
      "export const ServiceCIdentifier: ServiceIdentifier;",
    );
  });
});

describe("codegen helper internals", () => {
  const { computeRuntimeImports, createStubBlock, createRegistrationsBlock } =
    __codegenInternals;

  it("computes runtime imports for lazy services and providers", () => {
    const registrations = [
      createRegistration({
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            { expression: "Dep", referencedIdentifiers: [], isLazy: true },
          ],
        },
      }),
    ];
    const imports = computeRuntimeImports(registrations, true);
    expect(imports.has("Container")).toBe(true);
    expect(imports.has("dependenciesRegistry")).toBe(true);
    expect(imports.has("Lazy")).toBe(true);
    expect(imports.has("applyProviders")).toBe(true);
    expect(imports.has("registerServiceIdentifier")).toBe(true);
  });

  it("creates stub imports without duplicating reused bindings", () => {
    const dependencyImports: ResolvedDependencyImport[] = [
      {
        localName: "Helper",
        importPath: "/lib/helper.js",
        originalName: "Helper",
      },
      {
        localName: "Container",
        importPath: "alloy-di/runtime",
        originalName: "Container",
        reusesExistingBinding: true,
      },
    ];
    const output = createStubBlock(dependencyImports, [
      createRegistration({ importName: "LazySvc", isFactoryLazy: true }),
    ]);
    expect(output).toContain("import { Helper } from '/lib/helper.js';");
    expect(output).not.toContain("alloy-di/runtime");
    expect(output).toContain("class LazySvc {}");
  });

  it("formats registration blocks from lightweight entries", () => {
    const block = createRegistrationsBlock([
      { ctorName: "Svc", metaText: "{}" },
      { ctorName: "Other", metaText: "{ scope: 'singleton' }" },
    ]);
    expect(block).toContain("{ ctor: Svc, meta: {} }");
    expect(block).toContain("{ ctor: Other, meta: { scope: 'singleton' } }");
    expect(createRegistrationsBlock([])).toBe("const registrations = [];");
  });
});

const consumerMetadata = (token: string): ServiceMetadata => ({
  scope: ServiceScope.TRANSIENT,
  dependencies: [
    {
      expression: token,
      referencedIdentifiers: [token],
      isLazy: false,
    },
  ],
});

describe("codegen local name collisions (issue #17)", () => {
  it("renames a dependency import that collides with a factory-lazy stub", () => {
    const metas = [
      {
        className: "X",
        filePath: "/src/x.ts",
        metadata: {
          scope: ServiceScope.SINGLETON,
          dependencies: [],
          factory: {
            expression: "Lazy(() => import('/src/x.ts').then(m => m.X))",
            referencedIdentifiers: [],
            isLazy: true,
          },
        },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            { expression: "X", referencedIdentifiers: ["X"], isLazy: false },
          ],
        },
        referencedImports: [
          { name: "X", path: "/src/dep/x.ts", originalName: "X" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toContain("class X {}");
    expect(code).toContain("import { X as X_1 } from '/src/dep/x.ts';");
    expect(code).toContain("dependencies: () => [X_1]");
  });

  it("imports the real service when a dependency import shares its name", () => {
    const metas = [
      {
        className: "Y",
        filePath: "/src/y.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            { expression: "Y", referencedIdentifiers: ["Y"], isLazy: false },
          ],
        },
        referencedImports: [
          { name: "Y", path: "/src/tokens.ts", originalName: "Y" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    // The service keeps its name and its own import; the unrelated token
    // import is renamed instead of silently replacing the service binding.
    expect(code).toContain("import { Y } from '/src/y.ts';");
    expect(code).toContain("import { Y as Y_1 } from '/src/tokens.ts';");
    expect(code).toContain("{ ctor: Y, meta: { scope: 'singleton' } }");
    expect(code).toContain("dependencies: () => [Y_1]");
  });

  it("renames an identifier const that collides with a dependency import", () => {
    const metas = [
      {
        className: "Core",
        filePath: "/src/core.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            {
              expression: "CoreIdentifier",
              referencedIdentifiers: ["CoreIdentifier"],
              isLazy: false,
            },
          ],
        },
        referencedImports: [
          {
            name: "CoreIdentifier",
            path: "/src/ids.ts",
            originalName: "CoreIdentifier",
          },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toContain("import { CoreIdentifier } from '/src/ids.ts';");
    expect(code).toContain(
      "const CoreIdentifier_1 = registerServiceIdentifier(Core,",
    );
    expect(code).toContain("'Core': CoreIdentifier_1");
  });

  it("renames a service that collides with a runtime helper", () => {
    const metas = [
      {
        className: "Container",
        filePath: "/src/container.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toContain(
      "import { Container as Container_1 } from '/src/container.ts';",
    );
    expect(code).toContain("{ ctor: Container_1,");
  });

  it("deduplicates dependency imports that differ only by extension", () => {
    const metas = [
      {
        className: "ConsumerA",
        filePath: "/src/consumer-a.ts",
        metadata: consumerMetadata("Tok"),
        referencedImports: [
          { name: "Tok", path: "/src/tok.ts", originalName: "Tok" },
        ],
      },
      {
        className: "ConsumerB",
        filePath: "/src/consumer-b.ts",
        metadata: consumerMetadata("Tok"),
        referencedImports: [
          { name: "Tok", path: "/src/tok", originalName: "Tok" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    const tokImports = code.match(/import \{ Tok[^\n]*/g) ?? [];
    expect(tokImports).toEqual(["import { Tok } from '/src/tok.ts';"]);
    expect(code).not.toContain("Tok_1");
  });

  it("renames a service type import that collides with declaration imports", () => {
    const code = generateContainerTypeDefinition(
      [
        {
          className: "Container",
          filePath: "/src/container.ts",
          metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
        },
      ],
      (resolvedPath) => resolvedPath,
    );
    expect(code).toContain(
      "import { Container as Container_1 } from '/src/container.ts';",
    );
    expect(code).toContain("Container: ServiceIdentifier<Container_1>;");
  });

  it("reuses the service binding for a dependency import of the same export", () => {
    const metas = [
      {
        className: "Core",
        filePath: "/src/core.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            {
              expression: "Core",
              referencedIdentifiers: ["Core"],
              isLazy: false,
            },
          ],
        },
        referencedImports: [
          { name: "Core", path: "./core", originalName: "Core" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    const coreImports = code.match(/import \{ Core[^\n]*/g) ?? [];
    expect(coreImports).toEqual(["import { Core } from '/src/core.ts';"]);
    expect(code).toContain("dependencies: () => [Core]");
  });
});

describe("custom scope code generation", () => {
  const meta = {
    className: "Svc",
    filePath: "/src/svc.ts",
    metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
  };

  it("emits a scope-hierarchy registration when scopes are configured", () => {
    const code = generateContainerModule([meta], new Set(), [], {
      scopes: {
        session: { parent: "singleton" },
        request: { parent: "session" },
      },
    });
    expect(code).toContain("container._registerScopeHierarchy({");
    expect(code).toContain('"session": "singleton"');
    expect(code).toContain('"request": "session"');
  });

  it("emits no scope registration when no scopes are configured", () => {
    const code = generateContainerModule([meta], new Set(), []);
    expect(code).not.toContain("_registerScopeHierarchy");
  });

  // Regression for issue #59 / PR #69: custom runtime scopes were dropped from
  // the per-service meta block during codegen, silently degrading scoped
  // services to transient behavior in the generated (built) container.
  it("serializes a custom scope into the per-service meta block", () => {
    const scoped = {
      className: "SessionSvc",
      filePath: "/src/session-svc.ts",
      metadata: { scope: "session", dependencies: [] },
    };
    const code = generateContainerModule([scoped], new Set(), [], {
      scopes: { session: { parent: "singleton" } },
    });
    expect(code).toContain("scope: 'session'");
    expect(code).toContain("{ ctor: SessionSvc, meta: { scope: 'session' } }");
  });

  it("still serializes the built-in singleton scope", () => {
    const singleton = {
      className: "SingletonSvc",
      filePath: "/src/singleton-svc.ts",
      metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
    };
    const code = generateContainerModule([singleton], new Set(), []);
    expect(code).toContain(
      "{ ctor: SingletonSvc, meta: { scope: 'singleton' } }",
    );
  });

  it("omits the default transient scope from the meta block", () => {
    const transient = {
      className: "TransientSvc",
      filePath: "/src/transient-svc.ts",
      metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
    };
    const code = generateContainerModule([transient], new Set(), []);
    expect(code).not.toContain("scope: 'transient'");
    expect(code).toContain("{ ctor: TransientSvc, meta: {} }");
  });

  it("emits the AlloyScopes augmentation as a standalone module file", () => {
    const dts = generateScopeAugmentationDefinition(["session", "request"]);
    expect(dts).toBeDefined();
    expect(dts).toContain('declare module "alloy-di/runtime"');
    expect(dts).toContain("interface AlloyScopes");
    expect(dts).toContain('"session": true;');
    expect(dts).toContain('"request": true;');
    // Must be a module (augmentation) — hence the trailing export.
    expect(dts).toContain("export {};");
  });

  it("returns undefined when there are no custom scopes", () => {
    expect(generateScopeAugmentationDefinition([])).toBeUndefined();
  });

  it("keeps the container declaration a global script (no top-level export)", () => {
    const dts = generateContainerTypeDefinition([], (p) => p);
    expect(dts).toContain('declare module "virtual:alloy-container"');
    expect(dts).not.toContain('declare module "alloy-di/runtime"');
    expect(dts).not.toContain("export {};");
  });
});

describe("environment override injection", () => {
  const meta = {
    className: "Svc",
    filePath: "/src/svc.ts",
    metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
  };

  it("emits a setEnvDetectionOverrides call when isDev is provided", () => {
    const code = generateContainerModule([meta], new Set(), [], {
      isDev: false,
    });
    expect(code).toContain("setEnvDetectionOverrides");
    expect(code).toContain("setEnvDetectionOverrides({ isDev: false });");
    expect(code).toMatch(
      /import \{[^}]*setEnvDetectionOverrides[^}]*\} from 'alloy-di\/runtime';/,
    );
  });

  it("emits no override call when the mode is unknown", () => {
    const code = generateContainerModule([meta], new Set(), []);
    expect(code).not.toContain("setEnvDetectionOverrides");
  });

  it("renames a service that collides with the injected helper", () => {
    const colliding = {
      className: "setEnvDetectionOverrides",
      filePath: "/src/weird.ts",
      metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
    };
    const code = generateContainerModule([colliding], new Set(), [], {
      isDev: true,
    });
    expect(code).toContain(
      "import { setEnvDetectionOverrides as setEnvDetectionOverrides_1 } from '/src/weird.ts';",
    );
    expect(code).toContain("setEnvDetectionOverrides({ isDev: true });");
  });
});

describe("dependency expression identifier rewriting (issue #25)", () => {
  it("rewrites $-prefixed identifiers that need a rename", () => {
    const metas = [
      {
        className: "$Api",
        filePath: "/src/api.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            {
              expression: "$Api",
              referencedIdentifiers: ["$Api"],
              isLazy: false,
            },
          ],
        },
        referencedImports: [
          { name: "$Api", path: "/src/tokens.ts", originalName: "$Api" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toContain("import { $Api } from '/src/api.ts';");
    expect(code).toContain("import { $Api as $Api_1 } from '/src/tokens.ts';");
    expect(code).toContain("dependencies: () => [$Api_1]");
  });

  it("leaves lazy import specifiers and property names untouched by renames", () => {
    const metas = [
      {
        className: "Heavy",
        filePath: "/src/Heavy.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            {
              expression:
                "Lazy(() => import('/src/Heavy').then((m) => m.Heavy))",
              referencedIdentifiers: ["Heavy"],
              isLazy: true,
            },
          ],
        },
        referencedImports: [
          { name: "Heavy", path: "/src/other/heavy.ts", originalName: "Heavy" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    // The unrelated import is renamed, but neither the import('/src/Heavy')
    // specifier nor the m.Heavy export access may follow the rename.
    expect(code).toContain(
      "import { Heavy as Heavy_1 } from '/src/other/heavy.ts';",
    );
    expect(code).toContain("import('/src/Heavy').then((m) => m.Heavy)");
  });

  it("does not rewrite property-access names that match a renamed import", () => {
    const metas = [
      {
        className: "Y",
        filePath: "/src/y.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            {
              expression: "cfg.Y",
              referencedIdentifiers: ["cfg", "Y"],
              isLazy: false,
            },
          ],
        },
        referencedImports: [
          { name: "cfg", path: "/src/cfg.ts", originalName: "cfg" },
          { name: "Y", path: "/src/tokens.ts", originalName: "Y" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toContain("import { Y as Y_1 } from '/src/tokens.ts';");
    expect(code).toContain("dependencies: () => [cfg.Y]");
    expect(code).not.toContain("cfg.Y_1");
  });

  it("does not rewrite method or accessor keys that match a renamed import", () => {
    const metas = [
      {
        className: "Heavy",
        filePath: "/src/heavy.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            {
              expression:
                "make({ Heavy() { return Heavy; } }, { get Heavy() { return Heavy; } })",
              referencedIdentifiers: ["make", "Heavy"],
              isLazy: false,
            },
          ],
        },
        referencedImports: [
          { name: "make", path: "/src/make.ts", originalName: "make" },
          { name: "Heavy", path: "/src/other/heavy.ts", originalName: "Heavy" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toContain(
      "import { Heavy as Heavy_1 } from '/src/other/heavy.ts';",
    );
    // Method and getter keys keep their names; the references inside the
    // bodies follow the rename.
    expect(code).toContain(
      "make({ Heavy() { return Heavy_1; } }, { get Heavy() { return Heavy_1; } })",
    );
  });

  it("expands shorthand properties so object keys survive a rename", () => {
    const metas = [
      {
        className: "Y",
        filePath: "/src/y.ts",
        metadata: { scope: ServiceScope.SINGLETON, dependencies: [] },
      },
      {
        className: "Consumer",
        filePath: "/src/consumer.ts",
        metadata: {
          scope: ServiceScope.TRANSIENT,
          dependencies: [
            {
              expression: "make({ Y })",
              referencedIdentifiers: ["make", "Y"],
              isLazy: false,
            },
          ],
        },
        referencedImports: [
          { name: "make", path: "/src/make.ts", originalName: "make" },
          { name: "Y", path: "/src/tokens.ts", originalName: "Y" },
        ],
      },
    ];
    const code = generateContainerModule(metas, new Set(), []);
    expect(code).toContain("import { Y as Y_1 } from '/src/tokens.ts';");
    expect(code).toContain("dependencies: () => [make({ Y: Y_1 })]");
  });
});

describe("service identifier export key generation", () => {
  it("keeps long same-prefix service identifier keys distinct", () => {
    const firstPath =
      "/src/really/long/shared/prefix/for/collision/0000/service.ts";
    const secondPath =
      "/src/really/long/shared/prefix/for/collision/0001/service.ts";

    const code = generateContainerTypeDefinition(
      [
        {
          className: "Foo",
          filePath: firstPath,
          metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
        },
        {
          className: "Foo",
          filePath: secondPath,
          metadata: { scope: ServiceScope.TRANSIENT, dependencies: [] },
        },
      ],
      (resolvedPath) => resolvedPath,
    );

    const keyMatches = Array.from(
      code.matchAll(/^\s*(Foo_[a-z0-9]+): ServiceIdentifier</gm),
      (match) => match[1],
    );

    expect(Array.from(new Set(keyMatches))).toHaveLength(2);
  });
});

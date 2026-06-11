import { describe, it, expect } from "vitest";
import {
  generateContainerModule,
  generateContainerTypeDefinition,
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

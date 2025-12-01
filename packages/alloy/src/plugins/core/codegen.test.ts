import { describe, it, expect } from "vitest";
import {
  generateContainerModule,
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

  it("creates stub imports without duplicating runtime helpers", () => {
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
      },
    ];
    const runtimeImports = new Set([
      "Container",
      "dependenciesRegistry",
      "registerServiceIdentifier",
    ]);
    const output = createStubBlock(
      dependencyImports,
      [createRegistration({ importName: "LazySvc", isFactoryLazy: true })],
      runtimeImports,
    );
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

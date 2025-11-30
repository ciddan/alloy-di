import { describe, it, expect } from "vitest";
import {
  generateContainerModule,
  generateManifestTypeDefinition,
} from "./codegen";
import { ServiceScope } from "../../lib/scope";

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

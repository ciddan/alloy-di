import { describe, it, expect } from "vitest";
import { generateContainerModule } from "../core/codegen";
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

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { alloy } from "./index";

describe("Duplicate registration guard", () => {
  it("throws when a service is discovered locally and provided via manifest", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-"));
    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [
        {
          exportName: "Svc",
          importPath: "@scope/lib/svc",
          symbolKey: "alloy:@scope/lib/svc#Svc",
          scope: "transient" as const,
          deps: [],
          lazyDeps: [],
        },
      ],
      providers: [],
    };

    const plugin = alloy({
      manifests: [manifest],
      containerDeclarationDir: tmpDir,
    });
    const hook = plugin.configResolved;
    const config = { root: "/" } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class Svc {}
    `;
    const id = "/src/svc.ts";
    // @ts-expect-error testing transform
    plugin.transform(code, id);

    // @ts-expect-error testing load
    await expect(plugin.load("\0virtual:alloy-container")).rejects.toThrow(
      /Duplicate service registrations detected/,
    );
  });
});

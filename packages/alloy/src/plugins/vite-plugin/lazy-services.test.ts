import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import type { ServiceIdentifier } from "../../lib/service-identifiers";
import { alloy } from "./index";

const serviceCIdentifier = Symbol.for(
  "alloy:UNKNOWN_PACKAGE/src/service-c.ts#ServiceC",
) as ServiceIdentifier;

describe("Vite Plugin Alloy - lazyServices option", () => {
  it("injects factory Lazy wrapper for configured service", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-lazy-"));
    const plugin = alloy({
      lazyServices: [serviceCIdentifier],
      containerDeclarationDir: tmpDir,
    });
    const hook = plugin.configResolved;
    if (hook) {
      // @ts-expect-error testing hook
      hook({ root: "/" });
    }

    const code = `
      import { Injectable } from 'alloy-di/runtime';
      class DepA {}
      class DepB {}
      @Injectable(() => [DepA, DepB])
      export class ServiceC {}
    `;
    const id = "/src/service-c.ts";
    // @ts-expect-error test transform invocation
    plugin.transform(code, id);
    // @ts-expect-error test load invocation
    const generated = (await plugin.load(
      "\0virtual:alloy-container",
    )) as string;
    expect(generated).toMatch(/factory: Lazy\(.*ServiceC/);
    expect(generated).toMatch(/class ServiceC/); // stub synthesized
    expect(generated).toMatch(/dependencies: \(\) => \[DepA, DepB\]/);
    // Should not contain a static import statement (only dynamic import inside factory)
    expect(generated).not.toMatch(
      /import \{ ServiceC \} from '\/src\/service-c.ts'/,
    );
  });
});

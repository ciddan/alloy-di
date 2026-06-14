import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { alloy } from "./index";
import {
  applyBuildStart,
  applyConfigResolved,
  applyTransform,
  loadContainer,
} from "./test-utils";
import os from "node:os";
import path from "path";
import type { ResolvedConfig } from "vite";

describe("Vite Plugin Alloy - module generation", () => {
  it("generates a module for a class with no dependencies", async () => {
    const plugin = alloy();
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class ServiceA {}
    `;
    const id = "/src/service-a.ts";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("generates a module for a class with dependencies", async () => {
    const plugin = alloy();
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      import { DepA } from './dep-a';
      import { DepB } from './dep-b';
      @Injectable(() => [DepA, DepB])
      export class ServiceC {}
    `;
    const id = "/src/service-c.ts";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("generates a module for a class with a lazy dependency", async () => {
    const plugin = alloy();
    const code = `
      import { Injectable, Lazy } from 'alloy-di/runtime';
      @Injectable(() => [Lazy(() => import('./dep-a'))])
      export class ServiceD {}
    `;
    const id = "/src/service-d.ts";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("pre-scans configured source directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-source-dirs-"));
    try {
      const appDir = path.join(root, "app");
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(
        path.join(appDir, "service.ts"),
        `
          import { Singleton } from 'alloy-di/runtime';
          @Singleton()
          export class AppService {}
        `,
      );

      const plugin = alloy({ sourceDirs: ["app"] });
      applyConfigResolved(plugin, { root } as ResolvedConfig);
      applyBuildStart(plugin);

      const generatedCode = (await loadContainer(
        plugin,
        "\0virtual:alloy-container",
      )) as string;
      expect(generatedCode).toContain(
        `import { AppService } from '${path.join(root, "app/service.ts")}';`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains eagerly depended service even if also lazily referenced", async () => {
    const plugin = alloy();
    const eager = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class Core {}
    `;
    const mixed = `
      import { Injectable, Lazy } from 'alloy-di/runtime';
      @Injectable(() => [Core, Lazy(() => import('./core').then(m => m.Core))])
      export class Consumer {}
    `;
    applyTransform(plugin, eager, "/src/core.ts");
    applyTransform(plugin, mixed, "/src/consumer.ts");
    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    // Core should be imported & registered exactly once
    expect(generatedCode).toMatch(/import \{ Core \} from '\/src\/core.ts';/);
    expect(generatedCode).toMatch(/ctor: Core/);
    // Lazy reference preserved
    expect(generatedCode).toMatch(
      /Lazy\(\(\) => import\('\/src\/core'\)\.then\(m => m.Core\)\)/,
    );
  });

  describe("custom scopes", () => {
    const session = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable('session')
      export class UserSession {}
    `;

    it("registers the scope hierarchy in the generated module", async () => {
      const plugin = alloy({
        scopes: {
          session: { parent: "singleton" },
          request: { parent: "session" },
        },
      });
      applyTransform(plugin, session, "/src/user-session.ts");
      const code = (await loadContainer(
        plugin,
        "\0virtual:alloy-container",
      )) as string;
      expect(code).toContain("container._registerScopeHierarchy({");
      expect(code).toContain('"session": "singleton"');
    });

    it("throws a build error on a scope-stability violation", async () => {
      const plugin = alloy({
        scopes: { session: { parent: "singleton" } },
      });
      const captive = `
        import { Injectable } from 'alloy-di/runtime';
        import { UserSession } from './user-session';
        @Injectable(() => [UserSession], 'singleton')
        export class AppService {}
      `;
      applyTransform(plugin, session, "/src/user-session.ts");
      applyTransform(plugin, captive, "/src/app-service.ts");

      await expect(
        loadContainer(plugin, "\0virtual:alloy-container"),
      ).rejects.toThrow(/Scope stability violation/);
    });

    it("throws on an invalid scopes config (unknown parent)", async () => {
      const plugin = alloy({
        scopes: { request: { parent: "sesion" } },
      });
      applyTransform(plugin, session, "/src/user-session.ts");
      await expect(
        loadContainer(plugin, "\0virtual:alloy-container"),
      ).rejects.toThrow(/unknown parent 'sesion'/);
    });
  });

  it("treats a service as lazy-only after its eager reference is removed", async () => {
    const plugin = alloy();
    const core = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class Core {}
    `;
    const lazyConsumer = `
      import { Injectable, Lazy } from 'alloy-di/runtime';
      @Injectable(() => [Lazy(() => import('./core').then(m => m.Core))])
      export class LazyConsumer {}
    `;
    const eagerConsumer = `
      import { Injectable } from 'alloy-di/runtime';
      import { Core } from './core';
      @Injectable(() => [Core])
      export class EagerConsumer {}
    `;
    applyTransform(plugin, core, "/src/core.ts");
    applyTransform(plugin, lazyConsumer, "/src/lazy-consumer.ts");
    applyTransform(plugin, eagerConsumer, "/src/eager-consumer.ts");

    // First generation: the eager reference keeps Core eagerly registered.
    const first = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(first).toMatch(/import \{ Core \} from '\/src\/core(\.ts)?';/);

    // The eager reference is edited away, as a dev-server re-transform would.
    const eagerConsumerEdited = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class EagerConsumer {}
    `;
    applyTransform(plugin, eagerConsumerEdited, "/src/eager-consumer.ts");

    // Regeneration must see the surviving lazy reference and stop importing
    // Core eagerly; the first generation must not have consumed its lazy key.
    const second = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(second).not.toMatch(/import \{ Core \} from '\/src\/core(\.ts)?';/);
    expect(second).toMatch(/LazyConsumer/);
  });

  it("omits services referenced only via Lazy", async () => {
    const plugin = alloy();
    const lazyService = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class LazyOnly {}
    `;
    const consumer = `
      import { Injectable, Lazy } from 'alloy-di/runtime';
      @Injectable(() => [Lazy(() => import('./lazy-only').then(m => m.LazyOnly))])
      export class UsesLazy {}
    `;
    applyTransform(plugin, lazyService, "/src/lazy-only.ts");
    applyTransform(plugin, consumer, "/src/consumer.ts");
    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).toContain("UsesLazy");
    expect(generatedCode).not.toMatch(/import\s+\{\s+LazyOnly/);
    expect(generatedCode).not.toMatch(/ctor:\s+LazyOnly/);
  });

  it("generates a module for a singleton class", async () => {
    const plugin = alloy();
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable('singleton')
      export class SingletonService {}
    `;
    const id = "/src/singleton-service.ts";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("generates a module for a double quoted singleton class", async () => {
    const plugin = alloy();
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable("singleton")
      export class SingletonServiceDouble {}
    `;
    const id = "/src/singleton-service-double.ts";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("generates an empty module if no services are found", async () => {
    const plugin = alloy();
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("normalizes backslash paths to posix style", async () => {
    const plugin = alloy();
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable()
      export class WinPathService {}
    `;
    const id = "src\\nested\\win-path-service.ts";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("processes an Injectable class in a .tsx file", async () => {
    const plugin = alloy();
    const code = `
      import { Injectable } from 'alloy-di/runtime';
      @Injectable('singleton')
      export class UiComponent {}
      export const View = () => null;
    `;
    const id = "/src/ui-component.tsx";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("generates a module for a singleton class via shorthand", async () => {
    const plugin = alloy();
    const code = `
      import { Singleton } from 'alloy-di/runtime';
      @Singleton()
      export class ShSingleton {}
    `;
    const id = "/src/sh-singleton.ts";
    applyTransform(plugin, code, id);
    const generatedCode = await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    );
    expect(generatedCode).toMatchSnapshot();
  });

  it("imports provider modules when configured", async () => {
    const root = os.tmpdir();
    const plugin = alloy({
      providers: ["src/providers.ts", "providers/custom.ts"],
    });
    const hook = plugin.configResolved;
    const config = { root } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;

    const p0 = path.resolve(root, "src/providers.ts").replaceAll("\\", "/");
    const p1 = path.resolve(root, "providers/custom.ts").replaceAll("\\", "/");

    expect(generatedCode).toContain(`import providers_0 from '${p0}';`);
    expect(generatedCode).toContain(`import providers_1 from '${p1}';`);
    expect(generatedCode).toContain(
      "const providerDefinitions = [providers_0, providers_1]",
    );
  });

  it("ingests services from a manifest with bare specifier import", async () => {
    const svc = {
      exportName: "ManifestSvc",
      importPath: "@scope/manifest-svc",
      symbolKey: "alloy:@scope/manifest-svc#ManifestSvc",
      scope: "singleton" as const,
      deps: [],
      lazyDeps: [],
    };
    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [svc],
      providers: [],
    };

    const plugin = alloy({ manifests: [manifest] });
    const hook = plugin.configResolved;
    const config = {
      root: os.tmpdir(),
    } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).toContain(
      "import { ManifestSvc } from '@scope/manifest-svc'",
    );
    expect(generatedCode).toContain("scope: 'singleton'");
  });

  it("ingests eager deps from a manifest and aliases when necessary", async () => {
    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [
        {
          exportName: "Dep",
          importPath: "@scope/lib/dep",
          symbolKey: "alloy:@scope/lib/dep#Dep",
          // Singleton so the singleton Consumer's dependency satisfies the
          // scope-stability rule (a singleton may not capture a transient).
          scope: "singleton" as const,
          deps: [],
          lazyDeps: [],
        },
        {
          exportName: "Consumer",
          importPath: "@scope/lib/consumer",
          symbolKey: "alloy:@scope/lib/consumer#Consumer",
          scope: "singleton" as const,
          deps: ["Dep"],
          lazyDeps: [],
        },
      ],
      providers: [],
    };

    const plugin = alloy({ manifests: [manifest] });
    const hook = plugin.configResolved;
    const config = {
      root: os.tmpdir(),
    } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    // Expect imports for both Dep and Consumer using bare specifiers
    expect(generatedCode).toContain("import { Dep } from '@scope/lib/dep'");
    expect(generatedCode).toContain(
      "import { Consumer } from '@scope/lib/consumer'",
    );
    // Expect deps array referencing the identifier for Dep
    expect(generatedCode).toContain(
      "{ ctor: Consumer, meta: { scope: 'singleton', dependencies: () => [Dep] } }",
    );
  });

  it("ingests lazyDeps from a manifest with retry options", async () => {
    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [
        {
          exportName: "LazyTarget",
          importPath: "@scope/lib/lazy-target",
          symbolKey: "alloy:@scope/lib/lazy-target#LazyTarget",
          scope: "transient" as const,
          deps: [],
          lazyDeps: [],
        },
        {
          exportName: "Consumer",
          importPath: "@scope/lib/consumer",
          symbolKey: "alloy:@scope/lib/consumer#Consumer",
          scope: "transient" as const,
          deps: [],
          lazyDeps: [
            {
              exportName: "LazyTarget",
              importPath: "@scope/lib/lazy-target",
              retry: { retries: 2, backoffMs: 1 },
            },
          ],
        },
      ],
      providers: [],
    };

    const plugin = alloy({ manifests: [manifest] });
    const hook = plugin.configResolved;
    const config = {
      root: os.tmpdir(),
    } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    // Expect Lazy import with then and options
    expect(generatedCode).toContain(
      "Lazy(() => import('@scope/lib/lazy-target').then(m => m.LazyTarget), { retries: 2, backoffMs: 1 })",
    );
    // Ensure the Consumer registration exists and includes the Lazy dep
    expect(generatedCode).toContain("{ ctor: Consumer, meta: ");
  });

  it("preserves ordered v2 manifest dependencies", async () => {
    const manifest = {
      schemaVersion: 2,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [
        {
          exportName: "Dep",
          importPath: "@scope/lib/dep",
          symbolKey: "alloy:@scope/lib/dep#Dep",
          scope: "transient" as const,
          deps: [],
        },
        {
          exportName: "Consumer",
          importPath: "@scope/lib/consumer",
          symbolKey: "alloy:@scope/lib/consumer#Consumer",
          scope: "transient" as const,
          deps: [
            { kind: "class" as const, exportName: "Dep" },
            {
              kind: "lazy" as const,
              exportName: "LazyTarget",
              importPath: "@scope/lib/lazy-target",
              retry: { retries: 1, factor: 3 },
            },
            {
              kind: "token" as const,
              exportName: "ConfigToken",
              importPath: "@scope/lib/tokens",
            },
          ],
        },
      ],
      providers: [],
    };

    const plugin = alloy({ manifests: [manifest] });
    const hook = plugin.configResolved;
    const config = {
      root: os.tmpdir(),
    } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).toContain(
      "dependencies: () => [Dep, Lazy(() => import('@scope/lib/lazy-target').then(m => m.LazyTarget), { retries: 1, factor: 3 }), ConfigToken]",
    );
  });

  it("imports provider modules declared in a manifest", async () => {
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
      providers: ["@scope/lib/providers/default", "@scope/lib/providers/extra"],
    };

    const plugin = alloy({ manifests: [manifest] });
    const hook = plugin.configResolved;
    const config = {
      root: os.tmpdir(),
    } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    expect(generatedCode).toContain(
      "import providers_0 from '@scope/lib/providers/default';",
    );
    expect(generatedCode).toContain(
      "import providers_1 from '@scope/lib/providers/extra';",
    );
    expect(generatedCode).toContain(
      "const providerDefinitions = [providers_0, providers_1]",
    );
  });

  it("merges provider modules from config and manifest with dedup preserving order", async () => {
    const root = os.tmpdir();

    // Use resolved path for dedup check
    const providerPath = path
      .resolve(root, "src/providers.ts")
      .replaceAll("\\", "/");

    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [],
      providers: [providerPath, "@scope/lib/providers/default"],
    };

    const plugin = alloy({
      manifests: [manifest],
      providers: ["src/providers.ts", "providers/custom.ts"],
    });
    const hook = plugin.configResolved;
    const config = { root } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;

    const p0 = providerPath;
    const p1 = path.resolve(root, "providers/custom.ts").replaceAll("\\", "/");
    const p2 = "@scope/lib/providers/default";

    // Expect merged order: config src/providers, config providers/custom, manifest (dedup of providerPath and then @scope/ default)
    const idxA = generatedCode.indexOf(`import providers_0 from '${p0}';`);
    const idxB = generatedCode.indexOf(`import providers_1 from '${p1}';`);
    const idxC = generatedCode.indexOf(`import providers_2 from '${p2}';`);

    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
    expect(idxC).toBeGreaterThan(idxB);
    expect(generatedCode).toContain(
      "const providerDefinitions = [providers_0, providers_1, providers_2]",
    );
  });

  it("invokes applyProviders after decorator registrations when providers are present", async () => {
    const plugin = alloy({ providers: ["src/providers.ts"] });
    const hook = plugin.configResolved;
    const config = {
      root: os.tmpdir(),
    } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    // The container and registrations should be defined before provider invocation
    const idxRegistrations = generatedCode.indexOf("const registrations = ");
    const idxApplyProviders = generatedCode.indexOf(
      "applyProviders(container, definition);",
    );
    expect(idxRegistrations).toBeGreaterThanOrEqual(0);
    expect(idxApplyProviders).toBeGreaterThan(idxRegistrations);
  });

  it("imports token dependencies from manifest and wires them", async () => {
    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      buildMode: "bundled" as const,
      services: [
        {
          exportName: "ConsumerWithToken",
          importPath: "@scope/lib/consumer-with-token",
          symbolKey: "alloy:@scope/lib/consumer-with-token#ConsumerWithToken",
          scope: "transient" as const,
          deps: [],
          tokenDeps: [{ exportName: "ConfigToken", importPath: "@scope/lib" }],
          lazyDeps: [],
        },
      ],
      providers: [],
    };

    const plugin = alloy({ manifests: [manifest] });
    const hook = plugin.configResolved;
    const config = {
      root: os.tmpdir(),
    } as unknown as import("vite").ResolvedConfig;
    if (typeof hook === "function") {
      void hook.call({} as never, config);
    } else if (hook && typeof hook.handler === "function") {
      void hook.handler.call({} as never, config);
    }

    const generatedCode = (await loadContainer(
      plugin,
      "\0virtual:alloy-container",
    )) as string;
    // Token import line
    expect(generatedCode).toContain(
      "import { ConfigToken } from '@scope/lib';",
    );
    // Dependency list includes token identifier
    expect(generatedCode).toMatch(
      /dependencies:\s*\(\s*\)\s*=>\s*\[ConfigToken\]/,
    );
  });
});

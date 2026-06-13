import { describe, it, expect } from "vitest";
import { generateMermaidDiagram } from "./visualizer";
import type { BuildScope, DependencyDescriptor, DiscoveredMeta } from "./types";
import { createClassKey } from "./utils";

type ReferencedImport = NonNullable<
  DiscoveredMeta["referencedImports"]
>[number];

function dep(
  expression: string,
  referencedIdentifiers: string[],
  isLazy = false,
  ignoredIdentifiers?: string[],
): DependencyDescriptor {
  return {
    expression,
    referencedIdentifiers,
    ignoredIdentifiers,
    isLazy,
  };
}

function createMeta({
  className,
  filePath,
  scope,
  dependencies = [],
  referencedImports = [],
  identifierKey,
  factory,
}: {
  className: string;
  filePath: string;
  scope: BuildScope;
  dependencies?: DependencyDescriptor[];
  referencedImports?: ReferencedImport[];
  identifierKey?: string;
  factory?: DependencyDescriptor;
}): DiscoveredMeta {
  return {
    className,
    filePath,
    identifierKey: identifierKey ?? `id_${className}`,
    metadata: {
      scope,
      dependencies,
      ...(factory ? { factory } : {}),
    },
    referencedImports,
  };
}

describe("generateMermaidDiagram", () => {
  it("emits nodes and edges for service dependencies and tokens", () => {
    const serviceB = createMeta({
      className: "ServiceB",
      filePath: "/src/service-b.ts",
      scope: "transient",
      identifierKey: "id_ServiceB",
    });

    const serviceA = createMeta({
      className: "ServiceA",
      filePath: "/src/service-a.ts",
      scope: "singleton",
      identifierKey: "id_ServiceA",
      dependencies: [
        dep("ServiceB", ["ServiceB"]),
        dep("ConfigToken", ["ConfigToken"]),
      ],
      referencedImports: [
        {
          name: "ServiceB",
          path: "./service-b",
          originalName: "ServiceB",
        },
      ],
    });

    const artifact = generateMermaidDiagram({
      metas: [serviceA, serviceB],
    });

    expect(artifact.nodeCount).toBe(3);
    expect(artifact.edgeCount).toBe(2);
    expect(artifact.tokenCount).toBe(1);

    expect(artifact.diagram).toContain("graph LR");
    expect(artifact.diagram).toContain('id_ServiceA["ServiceA"]');
    expect(artifact.diagram).toContain('id_ServiceB["ServiceB"]');
    expect(artifact.diagram).toContain("id_ServiceA -->|Si→Tr| id_ServiceB");
    expect(artifact.diagram).toMatch(/Si→Tk/);
    expect(artifact.diagram).toContain("style token_ConfigToken fill:#4b5c6b");
  });

  it("styles lazy-only and factory services distinctly", () => {
    const lazyMeta = createMeta({
      className: "LazyOnly",
      filePath: "/src/lazy-only.ts",
      scope: "singleton",
      identifierKey: "id_LazyOnly",
    });

    const factoryMeta = createMeta({
      className: "FactoryService",
      filePath: "/src/factory.ts",
      scope: "transient",
      identifierKey: "id_Factory",
      factory: dep("() => import('./factory')", [], true),
    });

    const lazyKey = createClassKey("/src/lazy-only.ts", "LazyOnly");
    const artifact = generateMermaidDiagram({
      metas: [lazyMeta, factoryMeta],
      lazyClassKeys: new Set([lazyKey]),
    });

    expect(artifact.nodeCount).toBe(2);
    expect(artifact.edgeCount).toBe(0);

    expect(artifact.diagram).toContain("style id_LazyOnly fill:#6c5cb8");
    expect(artifact.diagram).toContain("style id_Factory fill:#9c6516");
  });

  it("resolves dependencies via import alias metadata", () => {
    const depMeta = createMeta({
      className: "RealDep",
      filePath: "/src/dep.ts",
      scope: "transient",
      identifierKey: "id_RealDep",
    });

    const consumer = createMeta({
      className: "Main",
      filePath: "/src/main.ts",
      scope: "singleton",
      identifierKey: "id_Main",
      dependencies: [dep("DepAlias", ["DepAlias"])],
      referencedImports: [
        {
          name: "DepAlias",
          path: "./dep",
          originalName: "RealDep",
        },
      ],
    });

    const artifact = generateMermaidDiagram({
      metas: [consumer, depMeta],
    });

    expect(artifact.nodeCount).toBe(2);
    expect(artifact.edgeCount).toBe(1);
    expect(artifact.tokenCount).toBe(0);
    expect(artifact.diagram).toContain("id_Main -->|Si→Tr| id_RealDep");
  });

  it("filters ignored helper identifiers from the graph", () => {
    const lazyMeta = createMeta({
      className: "LazyService",
      filePath: "/src/lazy-service.ts",
      scope: "transient",
      identifierKey: "id_LazyService",
    });

    const consumer = createMeta({
      className: "Consumer",
      filePath: "/src/consumer.ts",
      scope: "transient",
      identifierKey: "id_Consumer",
      dependencies: [
        dep(
          'Lazy(() => import("./lazy-service").then((m) => m.LazyService))',
          ["Lazy", "import", "then", "m", "LazyService"],
          true,
          ["then", "m"],
        ),
      ],
      referencedImports: [
        {
          name: "LazyService",
          path: "./lazy-service",
          originalName: "LazyService",
        },
      ],
    });

    const artifact = generateMermaidDiagram({
      metas: [consumer, lazyMeta],
    });

    expect(artifact.edgeCount).toBe(1);
    expect(artifact.diagram).toContain(
      "id_Consumer -.->|Tr→Tr| id_LazyService",
    );
    expect(artifact.diagram).not.toContain("token_then");
    expect(artifact.diagram).not.toContain("token_m");
  });

  it("infers dependency identifiers from promise expressions when metadata is empty", () => {
    const lazyMeta = createMeta({
      className: "LazyService",
      filePath: "/src/lazy-service.ts",
      scope: "transient",
      identifierKey: "id_Lazy",
    });

    const consumer = createMeta({
      className: "InferConsumer",
      filePath: "/src/infer-consumer.ts",
      scope: "singleton",
      identifierKey: "id_InferConsumer",
      dependencies: [
        dep(
          'Lazy(() => import("./lazy-service").then(module => module.LazyService))',
          [],
          true,
        ),
      ],
    });

    const artifact = generateMermaidDiagram({
      metas: [consumer, lazyMeta],
    });

    expect(artifact.edgeCount).toBe(1);
    expect(artifact.diagram).toContain("id_InferConsumer -.->|Si→Tr| id_Lazy");
  });

  it("deduplicates token nodes and trims long labels", () => {
    const longToken = "ExternalToken".repeat(6);
    const truncatedLabel = `${longToken.slice(0, 45)}…`;

    const consumer = createMeta({
      className: "TokenConsumer",
      filePath: "/src/token-consumer.ts",
      scope: "transient",
      identifierKey: "id_TokenConsumer",
      dependencies: [dep(longToken, [longToken]), dep(longToken, [longToken])],
    });

    const artifact = generateMermaidDiagram({
      metas: [consumer],
    });

    expect(artifact.tokenCount).toBe(1);
    expect(artifact.diagram).toContain(truncatedLabel);
  });

  it("resolves services imported via absolute paths", () => {
    const absoluteMeta = createMeta({
      className: "AbsoluteService",
      filePath: "/lib/absolute.ts",
      scope: "singleton",
      identifierKey: "id_Absolute",
    });

    const consumer = createMeta({
      className: "AbsoluteConsumer",
      filePath: "/src/absolute-consumer.ts",
      scope: "transient",
      identifierKey: "id_AbsoluteConsumer",
      dependencies: [dep("AbsoluteAlias", ["AbsoluteAlias"])],
      referencedImports: [
        {
          name: "AbsoluteAlias",
          path: "/lib/absolute.ts",
          originalName: "AbsoluteService",
        },
      ],
    });

    const artifact = generateMermaidDiagram({
      metas: [consumer, absoluteMeta],
    });

    expect(artifact.edgeCount).toBe(1);
    expect(artifact.diagram).toContain(
      "id_AbsoluteConsumer -->|Tr→Si| id_Absolute",
    );
  });

  describe("custom scopes", () => {
    const SCOPES = {
      session: { parent: "singleton" },
      request: { parent: "session" },
    };

    it("groups custom-scoped services into per-scope subgraphs", () => {
      const sessionSvc = createMeta({
        className: "UserSession",
        filePath: "/src/user-session.ts",
        scope: "session",
        identifierKey: "id_UserSession",
      });
      const requestSvc = createMeta({
        className: "RequestLogger",
        filePath: "/src/request-logger.ts",
        scope: "request",
        identifierKey: "id_RequestLogger",
      });
      const rootSvc = createMeta({
        className: "Config",
        filePath: "/src/config.ts",
        scope: "singleton",
        identifierKey: "id_Config",
      });

      const artifact = generateMermaidDiagram({
        metas: [sessionSvc, requestSvc, rootSvc],
        scopes: SCOPES,
      });

      expect(artifact.diagram).toContain('subgraph scope_session["session"]');
      expect(artifact.diagram).toContain('subgraph scope_request["request"]');
      // singleton service stays at the top level, not inside a subgraph
      expect(artifact.diagram).toContain('id_Config["Config"]');
      expect(artifact.diagram).toMatch(
        /subgraph scope_session[^]*id_UserSession/,
      );
      // custom scopes get distinct default fills (first two palette entries)
      expect(artifact.diagram).toContain("style id_UserSession fill:#a4548c");
      expect(artifact.diagram).toContain("style id_RequestLogger fill:#5e8c4f");
      expect(artifact.diagram).toContain("%% Custom scopes: session=#a4548c");
    });

    it("respects explicit scopeColors overrides for custom scopes", () => {
      const sessionSvc = createMeta({
        className: "UserSession",
        filePath: "/src/user-session.ts",
        scope: "session",
        identifierKey: "id_UserSession",
      });

      const artifact = generateMermaidDiagram({
        metas: [sessionSvc],
        scopes: SCOPES,
        options: { scopeColors: { session: "#123456" } },
      });

      expect(artifact.diagram).toContain("style id_UserSession fill:#123456");
    });

    it("highlights scope-stability violations with color and a warning label", () => {
      const requestSvc = createMeta({
        className: "RequestLogger",
        filePath: "/src/request-logger.ts",
        scope: "request",
        identifierKey: "id_RequestLogger",
      });
      const captiveSingleton = createMeta({
        className: "AppService",
        filePath: "/src/app-service.ts",
        scope: "singleton",
        identifierKey: "id_AppService",
        dependencies: [dep("RequestLogger", ["RequestLogger"])],
        referencedImports: [
          {
            name: "RequestLogger",
            path: "./request-logger",
            originalName: "RequestLogger",
          },
        ],
      });

      const artifact = generateMermaidDiagram({
        metas: [captiveSingleton, requestSvc],
        scopes: SCOPES,
      });

      expect(artifact.diagram).toContain("⚠️");
      expect(artifact.diagram).toMatch(
        /id_AppService -->\|Si→Re ⚠️\| id_RequestLogger/,
      );
      // The violating edge is colored red.
      expect(artifact.diagram).toContain("stroke:#ff4d4f");
    });

    it("does not flag singleton->transient when no scopes are configured", () => {
      const transientSvc = createMeta({
        className: "Helper",
        filePath: "/src/helper.ts",
        scope: "transient",
        identifierKey: "id_Helper",
      });
      const singletonSvc = createMeta({
        className: "AppService",
        filePath: "/src/app-service.ts",
        scope: "singleton",
        identifierKey: "id_AppService",
        dependencies: [dep("Helper", ["Helper"])],
        referencedImports: [
          { name: "Helper", path: "./helper", originalName: "Helper" },
        ],
      });

      const artifact = generateMermaidDiagram({
        metas: [singletonSvc, transientSvc],
      });

      expect(artifact.diagram).not.toContain("⚠️");
      expect(artifact.diagram).not.toContain("stroke:#ff4d4f");
    });
  });

  it("applies custom diagram options", () => {
    const singletonMeta = createMeta({
      className: "Root",
      filePath: "/src/root.ts",
      scope: "singleton",
      identifierKey: "id_Root",
    });

    const artifact = generateMermaidDiagram({
      metas: [singletonMeta],
      options: {
        direction: "RL",
        includeLegend: false,
        scopeColors: {
          singleton: "#ff0000",
          transient: "#00ff00",
        },
        nodeStrokeColor: "#123456",
        nodeTextColor: "#abcdef",
      },
    });

    expect(artifact.diagram.startsWith("graph RL")).toBe(true);
    expect(artifact.diagram).not.toMatch(/%% Legend/);
    expect(artifact.diagram).toContain(
      "style id_Root fill:#ff0000,stroke:#123456,color:#abcdef",
    );
  });
});

import { describe, it, expect } from "vitest";
import { generateMermaidDiagram } from "./visualizer";
import type { DependencyDescriptor, DiscoveredMeta } from "../core/types";
import type { ServiceScope } from "../../lib/scope";
import { createClassKey } from "../core/utils";

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
  scope: ServiceScope;
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
    expect(artifact.diagram).toContain(
      "id_ServiceA -->|Eager · singleton→transient · Class| id_ServiceB",
    );
    expect(artifact.diagram).toMatch(/singleton→token · Token/);
    expect(artifact.diagram).toContain("style token_ConfigToken fill:#d1d5db");
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

    expect(artifact.diagram).toContain("style id_LazyOnly fill:#e8def8");
    expect(artifact.diagram).toContain("style id_Factory fill:#ffe0b2");
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
    expect(artifact.diagram).toContain(
      "id_Main -->|Eager · singleton→transient · Class| id_RealDep",
    );
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
      "id_Consumer -.->|Lazy · transient→transient · Class| id_LazyService",
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
    expect(artifact.diagram).toContain(
      "id_InferConsumer -.->|Lazy · singleton→transient · Class| id_Lazy",
    );
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
      "id_AbsoluteConsumer -->|Eager · transient→singleton · Class| id_Absolute",
    );
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

import path from "node:path";
import type { DependencyDescriptor, DiscoveredMeta } from "../core/types";
import type { ServiceScope } from "../../lib/scope";
import {
  createClassKey,
  createSymbolKey,
  hashString,
  normalizeImportPath,
} from "../core/utils";

type GraphNodeType = "service" | "token";

interface GraphNode {
  id: string;
  label: string;
  key: string;
  scope?: ServiceScope;
  type: GraphNodeType;
  isLazyOnly: boolean;
  hasFactory: boolean;
  className?: string;
  filePath?: string;
}

interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  label: string;
  isLazy: boolean;
  stroke: string;
}

export interface MermaidDiagramOptions {
  direction?: "LR" | "TB" | "BT" | "RL";
  includeLegend?: boolean;
  scopeColors?: Partial<Record<ServiceScope, string>>;
  lazyNodeFill?: string;
  factoryNodeFill?: string;
  tokenNodeFill?: string;
  nodeStrokeColor?: string;
  nodeTextColor?: string;
  lazyEdgeColor?: string;
  eagerEdgeColor?: string;
  factoryEdgeColor?: string;
}

export interface MermaidDiagramInput {
  metas: DiscoveredMeta[];
  lazyClassKeys?: Set<string>;
  options?: MermaidDiagramOptions;
}

export interface MermaidDiagramArtifact {
  diagram: string;
  nodeCount: number;
  edgeCount: number;
  tokenCount: number;
}

const DEFAULT_SCOPE_COLORS: Record<ServiceScope, string> = {
  singleton: "#f6c14a",
  transient: "#58a6ff",
};

const DEFAULT_OPTIONS: Required<
  Pick<
    MermaidDiagramOptions,
    | "direction"
    | "includeLegend"
    | "scopeColors"
    | "lazyNodeFill"
    | "factoryNodeFill"
    | "tokenNodeFill"
    | "nodeStrokeColor"
    | "nodeTextColor"
    | "lazyEdgeColor"
    | "eagerEdgeColor"
    | "factoryEdgeColor"
  >
> = {
  direction: "LR",
  includeLegend: true,
  scopeColors: DEFAULT_SCOPE_COLORS,
  lazyNodeFill: "#e8def8",
  factoryNodeFill: "#ffe0b2",
  tokenNodeFill: "#d1d5db",
  nodeStrokeColor: "#1f2937",
  nodeTextColor: "#111827",
  lazyEdgeColor: "#a855f7",
  eagerEdgeColor: "#6b7280",
  factoryEdgeColor: "#ef6c00",
};

const RESERVED_IDENTIFIERS = new Set([
  "Lazy",
  "Symbol",
  "Promise",
  "import",
  "this",
  "arguments",
]);

/**
 * Generates a Mermaid diagram depicting the dependency graph for the provided services.
 * @param input - Discovered metadata, optional lazy keys, and rendering options.
 * @returns The rendered diagram plus simple counts useful for reporting.
 */
export function generateMermaidDiagram({
  metas,
  lazyClassKeys,
  options,
}: MermaidDiagramInput): MermaidDiagramArtifact {
  const mergedOptions: typeof DEFAULT_OPTIONS = {
    ...DEFAULT_OPTIONS,
    ...options,
    scopeColors: {
      ...DEFAULT_SCOPE_COLORS,
      ...options?.scopeColors,
    },
  };

  const lazyKeys = lazyClassKeys ?? new Set<string>();
  const serviceNodes: GraphNode[] = [];
  const nodesByClassName = new Map<string, GraphNode[]>();
  const nodesByFilePath = new Map<string, GraphNode[]>();
  const tokenNodes = new Map<string, GraphNode>();
  const nodeByMeta = new Map<DiscoveredMeta, GraphNode>();

  metas.forEach((meta, index) => {
    const key = createClassKey(meta.filePath, meta.className);
    const id = resolveNodeId(meta, index);
    const normalizedPath = normalizeImportPath(meta.filePath);
    const node: GraphNode = {
      id,
      label: meta.className,
      key,
      scope: meta.metadata.scope,
      type: "service",
      isLazyOnly: lazyKeys.has(key),
      hasFactory: Boolean(meta.metadata.factory),
      className: meta.className,
      filePath: normalizedPath,
    };

    serviceNodes.push(node);
    nodeByMeta.set(meta, node);

    const classBucket = nodesByClassName.get(meta.className) ?? [];
    classBucket.push(node);
    nodesByClassName.set(meta.className, classBucket);

    const pathBucket = nodesByFilePath.get(normalizedPath) ?? [];
    pathBucket.push(node);
    nodesByFilePath.set(normalizedPath, pathBucket);
  });

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  metas.forEach((meta) => {
    const sourceNode = nodeByMeta.get(meta);
    if (!sourceNode) {
      return;
    }

    const dependencies = meta.metadata.dependencies ?? [];
    for (const dep of dependencies) {
      const identifiers = gatherIdentifiers(dep);
      if (!identifiers.length) {
        continue;
      }

      const targets = new Map<string, GraphNode>();
      for (const ident of identifiers) {
        const resolvedTargets = resolveTargetsForIdentifier(
          ident,
          dep.expression,
          meta,
          nodesByClassName,
          nodesByFilePath,
          tokenNodes,
        );
        for (const target of resolvedTargets) {
          if (target.id === sourceNode.id) {
            continue;
          }
          targets.set(target.id, target);
        }
      }

      if (!targets.size) {
        continue;
      }

      for (const target of targets.values()) {
        const edgeKey = `${sourceNode.id}->${target.id}|${dep.isLazy}`;
        if (edgeKeys.has(edgeKey)) {
          continue;
        }
        edgeKeys.add(edgeKey);

        edges.push({
          from: sourceNode,
          to: target,
          label: describeEdge(sourceNode, target, dep.isLazy),
          isLazy: dep.isLazy,
          stroke: selectEdgeColor(dep.isLazy, target, mergedOptions),
        });
      }
    }
  });

  const lines: string[] = [`graph ${mergedOptions.direction}`];

  if (mergedOptions.includeLegend) {
    lines.push(
      `  %% Legend: singleton=${mergedOptions.scopeColors.singleton}, transient=${mergedOptions.scopeColors.transient}, lazy-only=${mergedOptions.lazyNodeFill}, factory=${mergedOptions.factoryNodeFill}, token=${mergedOptions.tokenNodeFill}`,
    );
    lines.push(
      `  %% Edge colors: eager=${mergedOptions.eagerEdgeColor}, lazy=${mergedOptions.lazyEdgeColor}, factory=${mergedOptions.factoryEdgeColor}`,
    );
  }

  const allNodes: GraphNode[] = [
    ...serviceNodes,
    ...Array.from(tokenNodes.values()),
  ];

  for (const node of allNodes) {
    const safeLabel = escapeMermaidLabel(node.label);
    lines.push(`  ${node.id}["${safeLabel}"]`);

    const styleParts = [
      nodeFill(node, mergedOptions),
      `stroke:${mergedOptions.nodeStrokeColor}`,
      `color:${mergedOptions.nodeTextColor}`,
    ].filter((part): part is string => Boolean(part));

    if (styleParts.length) {
      lines.push(`  style ${node.id} ${styleParts.join(",")}`);
    }
  }

  const linkStyles: string[] = [];
  let edgeIndex = 0;

  for (const edge of edges) {
    const arrow = edge.isLazy ? "-.->" : "-->";
    const safeLabel = escapeMermaidLabel(edge.label);
    lines.push(`  ${edge.from.id} ${arrow}|${safeLabel}| ${edge.to.id}`);
    linkStyles.push(
      `  linkStyle ${edgeIndex} stroke:${edge.stroke},color:${edge.stroke}`,
    );
    edgeIndex += 1;
  }

  lines.push(...linkStyles);

  return {
    diagram: lines.join("\n"),
    nodeCount: allNodes.length,
    edgeCount: edges.length,
    tokenCount: tokenNodes.size,
  };
}

/**
 * Produces a deterministic node identifier for a service, falling back to hashing the symbol key.
 */
function resolveNodeId(meta: DiscoveredMeta, index: number): string {
  const key =
    meta.identifierKey ?? createSymbolKey(meta.filePath, meta.className);
  return sanitizeMermaidId(key, index);
}

/**
 * Normalizes arbitrary strings into Mermaid-safe identifiers, hashing when a leading letter is missing.
 */
function sanitizeMermaidId(source: string, fallbackIndex: number): string {
  const condensed = source.replaceAll(/[^A-Za-z0-9_]/g, "_");
  if (condensed && /^[A-Za-z]/.test(condensed)) {
    return condensed;
  }
  return `n_${hashString(`${fallbackIndex}:${source}`)}`;
}

/**
 * Escapes problematic characters in labels so Mermaid renders them literally.
 */
function escapeMermaidLabel(label: string): string {
  return label.replaceAll('"', '\\"').replaceAll("|", "/");
}

/**
 * Builds a human-readable label describing the nature of an edge between two nodes.
 */
function describeEdge(
  from: GraphNode,
  to: GraphNode,
  depIsLazy: boolean,
): string {
  const nature = depIsLazy ? "Lazy" : "Eager";
  const fromScope = from.scope ?? "unknown";
  const toScope = to.type === "token" ? "token" : (to.scope ?? "unknown");
  const targetType =
    to.type === "token" ? "Token" : to.hasFactory ? "Factory" : "Class";
  return `${nature} · ${fromScope}→${toScope} · ${targetType}`;
}

/**
 * Determines the fill color for a node based on its type, scope, and lazy/factory flags.
 */
function nodeFill(
  node: GraphNode,
  opts: typeof DEFAULT_OPTIONS,
): string | undefined {
  if (node.type === "token") {
    return `fill:${opts.tokenNodeFill}`;
  }
  if (node.hasFactory) {
    return `fill:${opts.factoryNodeFill}`;
  }
  if (node.isLazyOnly) {
    return `fill:${opts.lazyNodeFill}`;
  }
  const scopeFill = node.scope ? opts.scopeColors[node.scope] : undefined;
  if (scopeFill) {
    return `fill:${scopeFill}`;
  }
  return undefined;
}

/**
 * Collects unique identifiers for a dependency, falling back to expression parsing if metadata is absent.
 */
function gatherIdentifiers(dep: DependencyDescriptor): string[] {
  const identifiers = new Set<string>();
  const ignored = new Set(dep.ignoredIdentifiers ?? []);
  for (const ident of dep.referencedIdentifiers ?? []) {
    const trimmed = ident.trim();
    if (!trimmed || RESERVED_IDENTIFIERS.has(trimmed) || ignored.has(trimmed)) {
      continue;
    }
    identifiers.add(trimmed);
  }

  if (!identifiers.size) {
    for (const inferred of inferIdentifiersFromExpression(dep.expression)) {
      const trimmed = inferred.trim();
      if (
        !trimmed ||
        RESERVED_IDENTIFIERS.has(trimmed) ||
        ignored.has(trimmed)
      ) {
        continue;
      }
      identifiers.add(trimmed);
    }
  }

  return Array.from(identifiers);
}

/**
 * Heuristically extracts likely identifier names from common Lazy import expressions.
 */
function inferIdentifiersFromExpression(expression: string): string[] {
  const matches = new Set<string>();
  const thenPattern =
    /\.then\(\s*(?:\w+)\s*=>\s*\w+\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = thenPattern.exec(expression)) !== null) {
    matches.add(match[1]);
  }
  if (!matches.size) {
    const simple = expression.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (simple) {
      matches.add(simple[1]);
    }
  }
  return Array.from(matches);
}

/**
 * Resolves a dependency identifier to known service nodes, or creates a token node when unresolved.
 */
function resolveTargetsForIdentifier(
  identifier: string,
  fallbackExpression: string,
  meta: DiscoveredMeta,
  nodesByClassName: Map<string, GraphNode[]>,
  nodesByFilePath: Map<string, GraphNode[]>,
  tokenNodes: Map<string, GraphNode>,
): GraphNode[] {
  const serviceMatches = resolveServiceTargets(
    identifier,
    meta,
    nodesByClassName,
    nodesByFilePath,
  );

  if (serviceMatches.length) {
    const deduped = new Map<string, GraphNode>();
    for (const node of serviceMatches) {
      deduped.set(node.id, node);
    }
    return Array.from(deduped.values());
  }

  const tokenLabel = createTokenLabel(identifier || fallbackExpression);
  return [ensureTokenNode(tokenNodes, tokenLabel)];
}

/**
 * Attempts to find service nodes that match an identifier via import metadata or class names.
 */
function resolveServiceTargets(
  identifier: string,
  meta: DiscoveredMeta,
  nodesByClassName: Map<string, GraphNode[]>,
  nodesByFilePath: Map<string, GraphNode[]>,
): GraphNode[] {
  const matches: GraphNode[] = [];
  const importRef = meta.referencedImports?.find(
    (ref) => !ref.isTypeOnly && ref.name === identifier,
  );

  if (importRef) {
    const normalizedPath = resolveImportSpecifierPath(
      meta.filePath,
      importRef.path,
    );
    if (normalizedPath) {
      const byPath = nodesByFilePath.get(normalizedPath);
      if (byPath && byPath.length) {
        if (
          importRef.originalName &&
          importRef.originalName !== "*" &&
          importRef.originalName !== "default"
        ) {
          for (const node of byPath) {
            if (node.className === importRef.originalName) {
              matches.push(node);
            }
          }
        }
        if (!matches.length) {
          matches.push(...byPath);
        }
      }
    }

    const fallbackName =
      importRef.originalName &&
      importRef.originalName !== "*" &&
      importRef.originalName !== "default"
        ? importRef.originalName
        : identifier;

    const byName = nodesByClassName.get(fallbackName);
    if (byName) {
      matches.push(...byName);
    }
  } else {
    const byName = nodesByClassName.get(identifier);
    if (byName) {
      matches.push(...byName);
    }
  }

  return matches;
}

/**
 * Normalizes an import specifier relative to the source file, supporting relative, absolute, and bare paths.
 */
function resolveImportSpecifierPath(
  sourceFilePath: string,
  specifier: string,
): string | undefined {
  if (!specifier) {
    return undefined;
  }
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(sourceFilePath), specifier);
    return normalizeImportPath(resolved);
  }
  if (specifier.startsWith("/")) {
    return normalizeImportPath(specifier);
  }
  return normalizeImportPath(specifier);
}

/**
 * Retrieves an existing token node or creates a new one with a sanitized identifier.
 */
function ensureTokenNode(
  tokenNodes: Map<string, GraphNode>,
  label: string,
): GraphNode {
  const existing = tokenNodes.get(label);
  if (existing) {
    return existing;
  }
  const id = sanitizeMermaidId(`token:${label}`, tokenNodes.size);
  const node: GraphNode = {
    id,
    label,
    key: label,
    scope: undefined,
    type: "token",
    isLazyOnly: false,
    hasFactory: false,
  };
  tokenNodes.set(label, node);
  return node;
}

/**
 * Condenses arbitrary strings into stable token labels, truncating overly long values.
 */
function createTokenLabel(raw: string): string {
  const condensed = raw.replaceAll(/\s+/g, " ").trim();
  if (!condensed) {
    return "anonymous-token";
  }
  return condensed.length > 48 ? `${condensed.slice(0, 45)}…` : condensed;
}

/**
 * Chooses the appropriate edge color based on laziness and whether the target is produced by a factory.
 */
function selectEdgeColor(
  isLazy: boolean,
  target: GraphNode,
  opts: typeof DEFAULT_OPTIONS,
): string {
  if (target.hasFactory) {
    return opts.factoryEdgeColor;
  }
  return isLazy ? opts.lazyEdgeColor : opts.eagerEdgeColor;
}

import path from "node:path";
import type { DependencyDescriptor, DiscoveredMeta } from "./types";
import { normalizeImportPath } from "./utils";

const SINGLETON = "singleton";
const TRANSIENT = "transient";

/** Identifiers that never refer to a discoverable service in a dependency expression. */
const RESERVED_IDENTIFIERS = new Set([
  "Lazy",
  "Symbol",
  "Promise",
  "import",
  "this",
  "arguments",
]);

/** Declared parent relationship for a single custom scope. */
export interface AlloyScopeConfig {
  /** The next-longer-lived scope. Either `"singleton"` or another custom scope. */
  parent: string;
}

/**
 * Hierarchy of custom, application-defined scopes keyed by scope name. The two
 * built-in lifecycles (`singleton` as the implicit root, `transient` as the
 * implicit leaf) are never declared here.
 */
export interface AlloyScopesConfig {
  [scopeName: string]: AlloyScopeConfig;
}

/**
 * Validates the `scopes` plugin configuration in isolation (independent of any
 * discovered services). Catches authoring mistakes — redeclaring a built-in
 * scope, pointing at an unknown or illegal parent, or forming a cycle — and
 * throws a single actionable error. Returns silently when the config is empty
 * or valid.
 */
export function validateScopesConfig(
  config: AlloyScopesConfig | undefined,
): void {
  if (!config) {
    return;
  }

  const names = Object.keys(config);
  if (names.length === 0) {
    return;
  }

  const errors: string[] = [];

  for (const name of names) {
    if (name === SINGLETON || name === TRANSIENT) {
      errors.push(
        `- '${name}' is a built-in lifecycle and cannot be declared in 'scopes'.`,
      );
    }
  }

  for (const name of names) {
    const declaredParent: string = config[name].parent;
    if (declaredParent === TRANSIENT) {
      errors.push(
        `- '${name}' declares 'transient' as its parent, but 'transient' is the implicit leaf and can never be a parent.`,
      );
    } else if (declaredParent !== SINGLETON && !(declaredParent in config)) {
      errors.push(
        `- '${name}' declares unknown parent '${declaredParent}'. Parents must be 'singleton' or another scope declared in 'scopes'.`,
      );
    }
  }

  // Cycle detection: every chain must terminate at the implicit `singleton`
  // root. Walk each scope's parent links, flagging any scope re-entered.
  for (const start of names) {
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current && current !== SINGLETON) {
      if (seen.has(current)) {
        errors.push(
          `- Cyclic scope hierarchy detected: ${[...seen, current].join(" -> ")}.`,
        );
        break;
      }
      seen.add(current);
      current = config[current]?.parent;
    }
  }

  if (errors.length) {
    throw new Error(
      ["[alloy] Invalid 'scopes' configuration:", ...dedupe(errors)].join("\n"),
    );
  }
}

/**
 * Returns the ancestor scopes of `scope` (longer-lived scopes it bubbles up
 * to), ordered nearest-first and always terminating with `singleton`. The
 * implicit `singleton` root has no ancestors; `transient` is the leaf and is
 * never an ancestor of anything.
 */
export function getAncestorScopes(
  scope: string,
  config: AlloyScopesConfig,
): string[] {
  if (scope === SINGLETON || scope === TRANSIENT) {
    return [];
  }
  // An undeclared custom scope degrades to depending on the root only.
  if (!(scope in config)) {
    return [SINGLETON];
  }

  const ancestors: string[] = [];
  let current: string | undefined = config[scope].parent;
  const guard = new Set<string>();
  while (current) {
    if (guard.has(current)) {
      break; // defensive: config should already be cycle-free
    }
    guard.add(current);
    ancestors.push(current);
    if (current === SINGLETON) {
      break;
    }
    current = config[current]?.parent;
  }
  return ancestors;
}

/**
 * Decides whether a service in `hostScope` may depend on a service in
 * `depScope`. A service may depend only on services in its own scope or a
 * longer-lived (ancestor) scope. `transient` (the leaf) may depend on anything;
 * nothing longer-lived may depend on a `transient`.
 */
export function isDependencyAllowed(
  hostScope: string,
  depScope: string,
  config: AlloyScopesConfig,
): boolean {
  if (hostScope === TRANSIENT) {
    return true;
  }
  if (depScope === hostScope) {
    return true;
  }
  return getAncestorScopes(hostScope, config).includes(depScope);
}

/** A long-lived service capturing a shorter-lived dependency. */
export interface ScopeStabilityViolation {
  hostClassName: string;
  hostScope: string;
  hostFilePath: string;
  depClassName: string;
  depScope: string;
}

/**
 * Validates the discovered service graph against the declared scope hierarchy:
 *
 * 1. **Unknown scope usage** — every service must declare a scope that is
 *    `singleton`, `transient`, or present in the `scopes` config.
 * 2. **Scope stability** — no service may depend on a shorter-lived
 *    (descendant) scope; such a captive dependency leaks the short-lived
 *    instance into its longer-lived host.
 *
 * All issues are gathered and reported together, mirroring the build's
 * circular-dependency diagnostics. Assumes `config` has already passed
 * {@link validateScopesConfig}.
 */
export function validateScopeStability(
  metas: DiscoveredMeta[],
  config: AlloyScopesConfig | undefined,
): void {
  const scopesConfig = config ?? {};
  const known = new Set<string>([
    SINGLETON,
    TRANSIENT,
    ...Object.keys(scopesConfig),
  ]);

  const { byClassName, byFilePath } = buildMetaIndexes(metas);

  const unknownScopeErrors: string[] = [];
  const violations: ScopeStabilityViolation[] = [];

  for (const host of metas) {
    const hostScope = host.metadata.scope;
    if (!known.has(hostScope)) {
      unknownScopeErrors.push(
        `- '${host.className}' declares unknown scope '${hostScope}'. Declare it in the 'scopes' plugin option or use a built-in lifecycle.`,
      );
      continue;
    }

    const visited = new Set<DiscoveredMeta>();
    for (const dep of host.metadata.dependencies) {
      for (const identifier of gatherIdentifiers(dep)) {
        for (const target of resolveServiceMetas(
          identifier,
          host,
          byClassName,
          byFilePath,
        )) {
          if (target === host || visited.has(target)) {
            continue;
          }
          visited.add(target);

          const depScope = target.metadata.scope;
          if (!known.has(depScope)) {
            continue; // reported when `target` is visited as a host
          }
          if (!isDependencyAllowed(hostScope, depScope, scopesConfig)) {
            violations.push({
              hostClassName: host.className,
              hostScope,
              hostFilePath: host.filePath,
              depClassName: target.className,
              depScope,
            });
          }
        }
      }
    }
  }

  if (!unknownScopeErrors.length && !violations.length) {
    return;
  }

  const sections: string[] = [];
  if (unknownScopeErrors.length) {
    sections.push(
      "[alloy] Unknown scope(s) used by discovered services:",
      ...dedupe(unknownScopeErrors),
    );
  }
  if (violations.length) {
    sections.push(
      "[alloy] Scope stability violation(s) detected — a longer-lived service may only depend on equal- or longer-lived scopes:",
      ...dedupe(
        violations.map(
          (v) =>
            `- '${v.hostClassName}' (${v.hostScope}) depends on '${v.depClassName}' (${v.depScope}), a shorter-lived scope. The dependency would be captured and leak.`,
        ),
      ),
    );
  }
  throw new Error(sections.join("\n"));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface MetaIndexes {
  byClassName: Map<string, DiscoveredMeta[]>;
  byFilePath: Map<string, DiscoveredMeta[]>;
}

function buildMetaIndexes(metas: DiscoveredMeta[]): MetaIndexes {
  const byClassName = new Map<string, DiscoveredMeta[]>();
  const byFilePath = new Map<string, DiscoveredMeta[]>();
  for (const meta of metas) {
    const classBucket = byClassName.get(meta.className) ?? [];
    classBucket.push(meta);
    byClassName.set(meta.className, classBucket);

    const normalizedPath = normalizeImportPath(meta.filePath);
    const pathBucket = byFilePath.get(normalizedPath) ?? [];
    pathBucket.push(meta);
    byFilePath.set(normalizedPath, pathBucket);
  }
  return { byClassName, byFilePath };
}

/**
 * Collects the candidate service identifiers a dependency expression refers to.
 * Mirrors the visualizer's resolution so stability edges match the rendered
 * graph: prefer recorded references, fall back to inferring from the raw
 * expression for lazy imports.
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
 * Resolves a dependency identifier to the service metas it targets, using
 * recorded import references (by path + export name) with a class-name
 * fallback. Identifiers that resolve to no service (e.g. tokens) yield nothing.
 */
function resolveServiceMetas(
  identifier: string,
  meta: DiscoveredMeta,
  byClassName: Map<string, DiscoveredMeta[]>,
  byFilePath: Map<string, DiscoveredMeta[]>,
): DiscoveredMeta[] {
  const matches: DiscoveredMeta[] = [];
  const importRef = meta.referencedImports?.find(
    (ref) => !ref.isTypeOnly && ref.name === identifier,
  );

  if (importRef) {
    const normalizedPath = resolveImportSpecifierPath(
      meta.filePath,
      importRef.path,
    );
    if (normalizedPath) {
      const byPath = byFilePath.get(normalizedPath);
      if (byPath?.length) {
        if (
          importRef.originalName &&
          importRef.originalName !== "*" &&
          importRef.originalName !== "default"
        ) {
          for (const candidate of byPath) {
            if (candidate.className === importRef.originalName) {
              matches.push(candidate);
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

    const byName = byClassName.get(fallbackName);
    if (byName) {
      matches.push(...byName);
    }
  } else {
    const byName = byClassName.get(identifier);
    if (byName) {
      matches.push(...byName);
    }
  }

  return dedupeMetas(matches);
}

function dedupeMetas(metas: DiscoveredMeta[]): DiscoveredMeta[] {
  return Array.from(new Set(metas));
}

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
  return normalizeImportPath(specifier);
}

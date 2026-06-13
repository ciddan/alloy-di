# Vite Plugin Configuration

The Vite plugin is the primary entry point for Alloy applications. It manages the virtual container module, HMR, and dev-time behavior.

## Usage

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { alloy } from "alloy-di/vite";

export default defineConfig({
  plugins: [
    alloy({
      // options
    }),
  ],
});
```

## Options

### providers

- **Type:** `string[]`
- **Default:** `[]`

List of file paths (relative to project root) containing `defineProviders()` calls. These modules are imported by the generated virtual container to register services, values, and lazy providers.

This is useful for integrating third-party libraries or legacy code that cannot use Alloy decorators.

```typescript
alloy({
  providers: ["src/providers.ts"],
});
```

### manifests

- **Type:** `AlloyManifest[]`
- **Default:** `[]`

List of manifest objects imported from internal libraries. Manifests allow Alloy to discover services and their dependencies from pre-built packages in a monorepo without scanning their source code.

See [Internal Libraries](/guide/libraries) for details on generating and consuming manifests.

```typescript
import { manifest } from "@acme/my-internal-lib/manifest";

alloy({
  manifests: [manifest],
});
```

### lazyServices

- **Type:** `ServiceIdentifier[]`
- **Default:** `[]`

List of `ServiceIdentifier` symbols to mark as **factory-lazy**.

When a service is marked as factory-lazy, Alloy will not import the service module statically in the generated container. Instead, it generates a stub and uses a dynamic import factory. This allows the entire service implementation (and its dependencies) to be split into a separate chunk that is loaded only when the service is first requested.

```typescript
import { serviceIdentifiers } from "./src/virtual-container";

alloy({
  lazyServices: [serviceIdentifiers.ReportingService],
});
```

### containerDeclarationDir

- **Type:** `string`
- **Default:** `"./src"`

Directory where the type declaration files (`alloy-container.d.ts` and `alloy-manifests.d.ts`) for the virtual module should be generated. When [custom scopes](/guide/scopes) are configured, an `alloy-scopes.d.ts` file is also emitted here.

These files provide TypeScript support for:

1. `virtual:alloy-container` module imports.
2. `serviceIdentifiers` type safety.
3. Custom scope name type-checking (via `alloy-scopes.d.ts`).

Relative paths are resolved against the project root.

### scopes

- **Type:** `Record<string, { parent: string }>`
- **Default:** `{}`

Declares custom, application-defined [hierarchical scopes](/guide/scopes) (lifecycles that sit between `singleton` and `transient`, such as `session` or `request`). Each entry names a scope and its `parent` — either `"singleton"` or another declared scope — establishing the lifecycle lattice.

```typescript
alloy({
  scopes: {
    session: { parent: "singleton" },
    request: { parent: "session" },
  },
});
```

This single declaration drives three things at build time:

1. **Type-safe scope names** — the names are emitted into a generated `alloy-scopes.d.ts` so `@Injectable("session")` type-checks and typos are caught.
2. **Scope-stability validation** — a longer-lived service depending on a shorter-lived one (a captive dependency) becomes a build error.
3. **Runtime hierarchy registration** — the parent ordering is baked into the generated container so child scopes can be validated against it.

Scope-stability validation only runs when this option is set, so projects without custom scopes are unaffected. See the [Hierarchical Scopes guide](/guide/scopes) for the full model.

### visualize

- **Type:** `boolean | AlloyVisualizationOptions`
- **Default:** `false`

```ts
interface AlloyVisualizationOptions {
  // Emit a Mermaid diagram. `true` uses defaults; pass an object to customize.
  mermaid?: boolean | AlloyMermaidVisualizerOptions;
}

interface AlloyMermaidVisualizerOptions {
  // Where to write the .mmd file (default: "./alloy-di.mmd").
  outputPath?: string;
  // Graph direction (default: "LR").
  direction?: "LR" | "TB" | "BT" | "RL";
  // Include the legend comment block (default: true).
  includeLegend?: boolean;

  // Node fills.
  scopeColors?: Partial<Record<ServiceScope, string>>;
  lazyNodeFill?: string;
  factoryNodeFill?: string;
  tokenNodeFill?: string;
  nodeStrokeColor?: string;
  nodeTextColor?: string;

  // Edge colors.
  lazyEdgeColor?: string;
  eagerEdgeColor?: string;
  factoryEdgeColor?: string;
}
```

Enables dependency graph emission. When set to `true`, the plugin writes a Mermaid (`.mmd`) diagram named `alloy-di.mmd` in the project root each time the container is regenerated. Provide an object to override the output path or any stylistic options supported by the visualizer. See [Dependency Graph Visualization](/guide/visualization) for how to read and render the output.

```ts
alloy({
  visualize: {
    mermaid: {
      outputPath: "./docs/di-graph.mmd",
      direction: "TB",
      includeLegend: false,
    },
  },
});
```

Set `visualize: false` (or omit the option) to disable artifact generation entirely, or pass `visualize: true` for the default `./alloy-di.mmd` output with standard styling.

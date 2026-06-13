# Dependency Graph Visualization

Because Alloy resolves your container at **build time**, it knows the entire
dependency graph — every service, how it's registered, and how each one wires to
the next. It can emit that graph as a [Mermaid](https://mermaid.js.org/) diagram
so you can _see_ your container instead of reasoning about it from scattered
decorators.

The diagram below is what Alloy produces for a small container:

```mermaid
graph LR
  %% Legend: singleton=#f6c14a, transient=#58a6ff, lazy-only=#e8def8, factory=#ffe0b2, token=#d1d5db
  %% Edge colors: eager=#6b7280, lazy=#a855f7, factory=#ef6c00
  id_AppService["AppService"]
  style id_AppService fill:#f6c14a,stroke:#1f2937,color:#111827
  id_Logger["Logger"]
  style id_Logger fill:#f6c14a,stroke:#1f2937,color:#111827
  id_HttpClient["HttpClient"]
  style id_HttpClient fill:#58a6ff,stroke:#1f2937,color:#111827
  id_ReportService["ReportService"]
  style id_ReportService fill:#e8def8,stroke:#1f2937,color:#111827
  token_ApiConfig["ApiConfig"]
  style token_ApiConfig fill:#d1d5db,stroke:#1f2937,color:#111827
  id_AppService -->|Eager · singleton→singleton · Class| id_Logger
  id_AppService -->|Eager · singleton→transient · Class| id_HttpClient
  id_AppService -.->|Lazy · singleton→singleton · Class| id_ReportService
  id_HttpClient -->|Eager · transient→token · Token| token_ApiConfig
  linkStyle 0 stroke:#6b7280,color:#6b7280
  linkStyle 1 stroke:#6b7280,color:#6b7280
  linkStyle 2 stroke:#a855f7,color:#a855f7
  linkStyle 3 stroke:#6b7280,color:#6b7280
```

At a glance you can read the **lifecycle** of every node, whether a dependency is
**eager or lazy**, and where unresolved **tokens** enter the graph.

## Enabling it

Set the [`visualize`](/config/vite-plugin#visualize) option on the plugin. Alloy
regenerates the artifact every time the container changes — during `vite dev`
(on HMR) and on `vite build`.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { alloy } from "alloy-di/vite";

export default defineConfig({
  plugins: [
    // Writes ./alloy-di.mmd with the default styling.
    alloy({ visualize: true }),
  ],
});
```

Pass an object to control the output path, direction, or colors:

```ts
alloy({
  visualize: {
    mermaid: {
      outputPath: "./docs/di-graph.mmd",
      direction: "TB", // LR (default) · TB · BT · RL
      includeLegend: true,
    },
  },
});
```

See the [`visualize` reference](/config/vite-plugin#visualize) for the full list
of style overrides (`scopeColors`, `lazyNodeFill`, `eagerEdgeColor`, and more).

## Reading the diagram

### Nodes

Each node is filled according to **how it's registered** in the container. The
checks are applied in order, so a factory-backed or lazy-only service keeps its
distinct color even if it also has a scope.

| Fill  | Default   | Meaning                                               |
| ----- | --------- | ----------------------------------------------------- |
| Amber | `#f6c14a` | **Singleton** service                                 |
| Blue  | `#58a6ff` | **Transient** service                                 |
| Lilac | `#e8def8` | **Lazy-only** service (reachable solely via `Lazy()`) |
| Peach | `#ffe0b2` | **Factory**-provided service                          |
| Grey  | `#d1d5db` | **Token** — an identifier with no resolved provider   |

### Edges

Edges point from a service to each of its dependencies:

- **Solid grey arrow** (`-->`) — an **eager** dependency, injected at construction.
- **Dotted purple arrow** (`-.->`) — a **lazy** dependency, deferred behind `Lazy()` and code-split.

Every edge is labelled with a compact summary:

```
Eager · singleton→transient · Class
└────┘   └──────┘ └───────┘   └───┘
 nature   source    target    target
 of dep   scope     scope     kind
```

`target kind` is one of `Class`, `Factory`, or `Token`.

## Rendering the `.mmd` file

The generated file is plain Mermaid text, so you can render it almost anywhere:

- **GitHub / GitLab** — paste the contents into a fenced ` ```mermaid ` block in any Markdown file; both render it natively.
- **VS Code** — the [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) extension previews `.mmd` files.
- **Browser** — paste it into the [Mermaid Live Editor](https://mermaid.live).
- **CLI / CI** — export to SVG or PNG with [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli):

  ```bash
  npx @mermaid-js/mermaid-cli -i alloy-di.mmd -o di-graph.svg
  ```

> [!TIP]
> Commit the `.mmd` (or a rendered SVG) and your dependency graph becomes a
> reviewable artifact — diffs show exactly when a service changes lifecycle,
> gains a dependency, or switches between eager and lazy wiring.

---
"alloy-di": major
---

Remove the dangling top-level `module`/`types` package fields, which pointed at
a `dist/index.*` bundle the build never emitted. `alloy-di` is intentionally a
subpath-only package: import from its documented entry points
(`alloy-di/runtime`, `alloy-di/vite`, `alloy-di/webpack`, `alloy-di/rspack`,
`alloy-di/rollup`, `alloy-di/generate`, `alloy-di/scopes`). A bare
`import … from "alloy-di"` was never resolvable and remains unsupported.

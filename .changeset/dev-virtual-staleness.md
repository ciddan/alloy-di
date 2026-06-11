---
"alloy-di": patch
---

Fix the generated container going stale during development. The plugin now
regenerates `virtual:alloy-container` on HMR: editing a service's scope,
dependencies, or factory, adding a new decorated file, or deleting one
invalidates the container module and triggers a reload, instead of serving
the version captured when the dev server started. Edits that don't affect the
DI graph (e.g. a method body) keep their normal HMR. The plugin also runs as
`enforce: "pre"` so discovery always scans the original TypeScript source.

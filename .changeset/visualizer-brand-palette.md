---
"alloy-di": patch
---

Refresh the dependency-graph visualizer's default palette to a cohesive,
brand-aligned scheme: steel-blue singletons, teal transients, violet lazy-only
services, bronze factories, and slate tokens, with white node text for stronger
contrast. Eager/lazy/factory edge colors were retuned to match. All colors
remain overridable via the `visualize.mermaid` options; only the defaults
changed.

Edge labels are now a compact `source→target` scope transition (e.g. `Si→Tr`,
with `Si`/`Tr`/`Tk` for singleton/transient/token) instead of the verbose
`Eager · singleton→transient · Class` form. The eager/lazy nature is already
conveyed by the arrow style and the target kind by node color, and a key is
emitted in the legend comment.

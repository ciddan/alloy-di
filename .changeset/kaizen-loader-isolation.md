---
"alloy-di": patch
---

Keep container regeneration free of side effects on discovery state. The
virtual container loader previously mutated the discovery runtime's shared
metas and lazy-key set on every load: `lazyServices` factory wrappers were
injected into cached metas (causing spurious full reloads on unrelated edits),
manifest lazy keys leaked into the runtime set, and lazy keys removed during
eager-reference reconciliation stayed lost across HMR-triggered regenerations.
The loader now works on copies, making each regeneration independent.

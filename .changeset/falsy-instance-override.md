---
"alloy-di": patch
---

Fix `overrideInstance` to honor deliberately falsy overrides (`null`, `0`,
`""`, `false`). Resolution now checks for the presence of an override/cached
instance rather than its truthiness, so a falsy test double short-circuits
resolution instead of falling through to construct the real service.

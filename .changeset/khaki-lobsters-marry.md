---
"alloy-di": patch
---

Fix three edge-case runtime and codegen correctness issues in Alloy. The
container no longer caches missing service metadata before late registrations
arrive, long same-prefix paths now hash deterministically without precision
loss, and explicit service identifiers still resolve correctly even if a
constructor was auto-registered first.

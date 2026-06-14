---
"alloy-di": major
---

Always enforce scope stability for the built-in lifecycles. A singleton service
may no longer depend on a transient one: the transient would be captured by the
longer-lived singleton and effectively leak. Previously this was only checked
when custom `scopes` were configured (to preserve v1 behavior); it now applies
to every build with no configuration required.

This is a breaking change. Builds with a singleton (or any longer-lived service)
that depends on a transient will now fail with a scope-stability violation.
Resolve it by making the dependency at least as long-lived as its host, or by
making the host transient or custom scoped.

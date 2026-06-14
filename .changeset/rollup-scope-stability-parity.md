---
"alloy-di": major
---

The Rollup manifest plugin now enforces the base scope-stability rule on every
build, matching the consumer plugins: a longer-lived service may not depend on a
shorter-lived one, so a singleton may not depend on a transient. Previously the
Rollup plugin only validated when custom `scopes` were configured. Library
builds with a captive dependency will now fail with a scope-stability violation.

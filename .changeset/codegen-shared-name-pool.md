---
"alloy-di": patch
---

Allocate all generated-module local names from a single shared pool. Service
imports, factory-lazy stubs, dependency imports, identifier consts, and
runtime helpers previously drew names from uncoordinated allocators, so a
dependency import sharing a name with a factory-lazy service produced a
duplicate declaration (SyntaxError), and a non-factory service whose name
collided with a dependency import was silently registered with the wrong
constructor. Dependency references that resolve to a registered service now
reuse the service's binding instead of relying on name-based deduplication.

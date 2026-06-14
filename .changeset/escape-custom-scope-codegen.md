---
"alloy-di": patch
---

Harden code generation to escape single quotes when serializing a custom scope
name into the per-service meta block, so an unusual scope name can no longer
break out of the generated string literal.

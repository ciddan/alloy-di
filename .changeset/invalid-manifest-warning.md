---
"alloy-di": patch
---

Warn when a library manifest fails schema validation instead of dropping it
silently. A dropped manifest removes all of that library's services and
providers from the container, and the first symptom was an unrelated-looking
resolution error at runtime in the consuming app. The build now logs
`[alloy] Ignoring invalid manifest "<packageName>"` together with the zod
validation issues.

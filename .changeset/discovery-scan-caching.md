---
"alloy-di": patch
---

Cut redundant TS parsing during discovery. The discovery store now keeps a
content hash per file and serves identical content from its cache, which
collapses the buildStart pre-scan + transform double parse into a single
scan per file content. The scanner also skips the TS parse entirely for
files that cannot contribute discovery results — no `@` (required by
decorator syntax) and no `Lazy` identifier. Note the pre-filter deliberately
does not check for the `Injectable`/`Singleton` names: decorator provenance
supports renamed re-exports (`export { Injectable as Register }`), so a
service file may contain neither.

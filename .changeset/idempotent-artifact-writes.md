---
"alloy-di": patch
---

Skip rewriting generated artifacts whose content has not changed. Every
container load wrote `alloy-container.d.ts`, `alloy-manifests.d.ts`, and the
Mermaid diagram unconditionally — in dev that happens on every HMR-triggered
regeneration and pokes tsc --watch, IDE TypeScript servers, and file
watchers (including the bundler's own) for no reason. All three artifacts
now go through a write-if-changed helper that serves repeat regenerations
from an in-memory record of the last written content (the artifacts are
volatile — manual edits are clobbered on the next content change), falling
back to a disk read-compare only on the first emission of a session. The
generated declaration files and the Mermaid diagram now carry an
"auto-generated, manual changes will be overwritten" header making that
explicit.

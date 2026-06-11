---
"alloy-di": patch
---

Fix library manifest generation so constructor dependencies preserve their
declared order when manifests are consumed. Interleaved eager, token, and lazy
dependencies now round-trip correctly, and lazy dependencies are recorded per
service instead of being shared across every service declared in the same file.

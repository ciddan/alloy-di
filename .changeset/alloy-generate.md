---
"alloy-di": patch
---

Add `alloy generate` and `alloy-di/generate` for writing Alloy declaration
artifacts before type-checking, without running a Vite build. The Vite plugin
and generator now also support `sourceDirs` for scanning services outside
`src`.

---
"alloy-di": patch
---

Expand the webpack/Rspack adapter test suite: assert the generated container
module is well-formed, that the bundler mode is injected into env detection,
that the cache file and source directories are registered as build/watch
dependencies, and that an array-form `resolve.alias` is appended to (and an
existing entry updated) rather than overwritten.

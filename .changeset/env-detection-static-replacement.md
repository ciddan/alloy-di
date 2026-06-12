---
"alloy-di": minor
---

Fix production-mode detection in bundled browser apps, and let the Vite
plugin pin the mode at build time. `isDevEnvironment` read `import.meta.env`
through an intermediate variable and guarded `process.env.NODE_ENV` behind
`typeof process`, both of which defeat bundlers' static define replacement —
so a standard Vite production browser build detected no hints, fell back to
dev mode, and emitted the factory-lazy warning in production. Detection now
keeps the literal `import.meta.env` / `process.env.NODE_ENV` expressions so
replacement applies. Additionally, the generated container module now calls
the new `setEnvDetectionOverrides({ isDev })` runtime export with the
bundler's authoritative mode, so plugin-driven setups never rely on runtime
sniffing at all. The no-hints fallback remains development, which keeps
warnings working in plain-Node usage.

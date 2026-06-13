# alloy-di

## 1.4.0

### Minor Changes

- fd45330: Add support for hierarchical scopes, enabling custom lifecycles like `session` and `request` between `singleton` and `transient`.

## 1.3.0

### Minor Changes

- 3e389fd: Fix production-mode detection in bundled browser apps, and let the Vite
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

### Patch Changes

- 42efea5: Rewrite dependency-expression identifiers by AST position instead of a
  `\b`-regex text replacement. The regex never matched `$`-prefixed class names
  (leaving the generated module referencing an unimported or wrong binding) and
  rewrote matching text inside string literals and property names — a renamed
  identifier could corrupt a lazy `import('/src/Api')` specifier or an
  `m.Api` export access. Expressions are now parsed and only true identifier
  references are rewritten; shorthand object properties expand
  (`{ Api }` -> `{ Api: Api_1 }`) so keys survive renames.
- 1f3b1e2: Cut redundant TS parsing during discovery. The discovery store now keeps a
  content hash per file and serves identical content from its cache, which
  collapses the buildStart pre-scan + transform double parse into a single
  scan per file content. The scanner also skips the TS parse entirely for
  files that cannot contribute discovery results — no `@` (required by
  decorator syntax) and no `Lazy` identifier. Note the pre-filter deliberately
  does not check for the `Injectable`/`Singleton` names: decorator provenance
  supports renamed re-exports (`export { Injectable as Register }`), so a
  service file may contain neither.
- 2442156: Skip rewriting generated artifacts whose content has not changed. Every
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
- 219652b: Warn when a library manifest fails schema validation instead of dropping it
  silently. A dropped manifest removes all of that library's services and
  providers from the container, and the first symptom was an unrelated-looking
  resolution error at runtime in the consuming app. The build now logs
  `[alloy] Ignoring invalid manifest "<packageName>"` together with the zod
  validation issues.
- 7ee6bbf: Refresh the dependency-graph visualizer's default palette to a cohesive,
  brand-aligned scheme: steel-blue singletons, teal transients, violet lazy-only
  services, bronze factories, and slate tokens, with white node text for stronger
  contrast. Eager/lazy/factory edge colors were retuned to match. All colors
  remain overridable via the `visualize.mermaid` options; only the defaults
  changed.

  Edge labels are now a compact `source→target` scope transition (e.g. `Si→Tr`,
  with `Si`/`Tr`/`Tk` for singleton/transient/token) instead of the verbose
  `Eager · singleton→transient · Class` form. The eager/lazy nature is already
  conveyed by the arrow style and the target kind by node color, and a key is
  emitted in the legend comment.

- 3e389fd: Harden the `buildStart` source scan against symlink cycles. A symlink under
  `src/` pointing back at an ancestor directory made the recursive walk follow
  it until the kernel's `ELOOP` limit aborted the build. Directories are now
  tracked by real path so cycles terminate (symlinked directories are still
  followed once), broken symlinks are skipped, dotfiles and dot-directories
  are no longer scanned, and the walk stats each entry once via dirents
  instead of twice.

## 1.2.3

### Patch Changes

- f506e09: Reject bare `@Injectable` / `@Singleton` (missing parentheses) instead of
  silently replacing the decorated class. Applied without parentheses, the
  decorator factory received the class itself, mistook it for a dependencies
  thunk, and returned a decorator function that legacy decorator semantics then
  substituted for the class — while the build-time scanner also skipped the
  service entirely. The runtime now throws a `TypeError` pointing at the fix,
  and the scanner emits a build warning with the file and line when it sees a
  bare alloy decorator.
- 76de868: Allocate all generated-module local names from a single shared pool. Service
  imports, factory-lazy stubs, dependency imports, identifier consts, and
  runtime helpers previously drew names from uncoordinated allocators, so a
  dependency import sharing a name with a factory-lazy service produced a
  duplicate declaration (SyntaxError), and a non-factory service whose name
  collided with a dependency import was silently registered with the wrong
  constructor. Dependency references that resolve to a registered service now
  reuse the service's binding instead of relying on name-based deduplication.
- fbfbb91: Keep container regeneration free of side effects on discovery state. The
  virtual container loader previously mutated the discovery runtime's shared
  metas and lazy-key set on every load: `lazyServices` factory wrappers were
  injected into cached metas (causing spurious full reloads on unrelated edits),
  manifest lazy keys leaked into the runtime set, and lazy keys removed during
  eager-reference reconciliation stayed lost across HMR-triggered regenerations.
  The loader now works on copies, making each regeneration independent.
- 88d52b2: Fix three edge-case runtime and codegen correctness issues in Alloy. The
  container no longer caches missing service metadata before late registrations
  arrive, long same-prefix paths now hash deterministically without precision
  loss, and explicit service identifiers still resolve correctly even if a
  constructor was auto-registered first.
- acc6cb4: Stop retrying deterministic lazy-import validation failures. When a lazy
  importer resolved successfully but did not yield a class constructor, the
  validation error was thrown inside the retry loop, so it was retried with
  full exponential backoff and finally re-wrapped as "Failed to import lazy
  dependency", burying the actual "Lazy importer did not return a class"
  diagnosis. Retries now apply only to the dynamic import itself; post-import
  validation fails immediately with the original message.

## 1.2.2

### Patch Changes

- e4f78b3: Fix service scanning so Alloy only recognizes `@Injectable` and `@Singleton`
  decorators that resolve back to `alloy-di/runtime`. Aliased imports, namespace
  imports, and local re-exports still work, while unrelated decorators with the
  same names are ignored.

## 1.2.1

### Patch Changes

- ba5198e: Fix the generated container going stale during development. The plugin now
  regenerates `virtual:alloy-container` on HMR: editing a service's scope,
  dependencies, or factory, adding a new decorated file, or deleting one
  invalidates the container module and triggers a reload, instead of serving
  the version captured when the dev server started. Edits that don't affect the
  DI graph (e.g. a method body) keep their normal HMR. The plugin also runs as
  `enforce: "pre"` so discovery always scans the original TypeScript source.
- d0b79bd: Fix library manifest generation so constructor dependencies preserve their
  declared order when manifests are consumed. Interleaved eager, token, and lazy
  dependencies now round-trip correctly, and lazy dependencies are recorded per
  service instead of being shared across every service declared in the same file.
- c03cfaa: Fix duplicate service registration checks so Alloy compares stable service
  identities instead of class names alone. Libraries and apps can now define
  services with the same class name without triggering false duplicate errors,
  while true identity collisions still fail the build.

## 1.2.0

### Minor Changes

- 940968e: Add Vite 8 (Rolldown) support while remaining compatible with Vite 7.
  - The virtual container module now declares `moduleType: "js"` so Rolldown can load the extension-less id.
  - `resolveId`, `transform`, and `load` use object-form hooks with id filters, letting Rolldown evaluate them natively so non-matching modules never cross the Rust/JS boundary. Vite 7 (6.3+) honors the same filters.
  - The deprecated `handleHotUpdate` hook was replaced with the Environment API `hotUpdate` hook. File deletions are now detected via the explicit `"delete"` event in addition to module-graph absence.
  - `vite` (`^7.0.0 || ^8.0.0`, optional) and `typescript` (`>=5.0.0`) are now declared as peer dependencies. TypeScript was always required at runtime by the scanner; the declaration only makes the existing requirement explicit.

## 1.1.0

### Minor Changes

- 7200679: feat: adds an option to visualize registered components in the container using a mermaid diagram.

## 1.0.0

### Major Changes

- 1cb06a9: Initial release.

### Patch Changes

- e99c59f: synthetic bump to test release workflows

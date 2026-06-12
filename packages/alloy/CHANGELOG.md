# alloy-di

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

# alloy-di

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

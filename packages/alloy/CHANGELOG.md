# alloy-di

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

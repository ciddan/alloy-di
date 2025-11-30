# Alloy Examples

This directory collects the sample projects used throughout the Alloy documentation. Each package demonstrates a different way to adopt `alloy-di`.

| Package | Description |
| --- | --- |
| [`@alloy-di/example-app`](./app/) | A Vite + React application that consumes decorated services, registers plain classes via providers, ingests manifests from internal libraries, and showcases lazy loading through Suspense. |
| [`@alloy-di/example-library-internal`](./library-internal/) | An internal monorepo library that uses Alloy decorators directly and emits an `alloy.manifest.mjs` during its build, illustrating how first-party packages can share services. |
| [`@alloy-di/example-library-external`](./library-external/) | A lightweight external-style library built with plain classes and provider registrations, useful for testing provider APIs and consumers that cannot use decorators. |

## Running the examples

```bash
pnpm install
pnpm --filter @alloy-di/example-app dev     # start the React demo
pnpm --filter @alloy-di/example-library-internal build
pnpm --filter @alloy-di/example-library-external build
```

Use these projects as references when wiring Alloy into your own applications or packages.

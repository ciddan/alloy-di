# Alloy webpack/Rspack Example

This package reuses the React source from [`../app-vite`](../app-vite/) and runs it through Alloy's webpack and Rspack application adapters.

The two configs intentionally share the same `alloyOptions` object in `alloy-options.mjs` so the example demonstrates bundler compatibility without duplicating the app.

## Commands

```bash
pnpm --filter @alloy-di/example-app-webpack-rspack build:webpack
pnpm --filter @alloy-di/example-app-webpack-rspack build:rspack
```

For local development:

```bash
pnpm --filter @alloy-di/example-app-webpack-rspack dev:webpack
pnpm --filter @alloy-di/example-app-webpack-rspack dev:rspack
```

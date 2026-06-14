# Webpack / Rspack Plugin Configuration

Alloy ships explicit webpack and Rspack adapters for applications on those bundlers. They use the same `AlloyPluginOptions` as `alloy-di/vite` and generate the same `virtual:alloy-container` module.

## Webpack

```js
// webpack.config.mjs
import alloy from "alloy-di/webpack";

export default {
  plugins: [
    alloy({
      sourceDirs: ["src"],
    }),
  ],
};
```

Generate declarations before type-checking with the webpack config loader:

```bash
alloy generate --bundler webpack
```

## Rspack

```js
// rspack.config.mjs
import alloy from "alloy-di/rspack";

export default {
  plugins: [
    alloy({
      sourceDirs: ["src"],
    }),
  ],
};
```

Generate declarations before type-checking with the Rspack config loader:

```bash
alloy generate --bundler rspack
```

## Behavior

- `virtual:alloy-container` is resolved to an Alloy-generated cache module under `node_modules/.cache/alloy-di`.
- Configured `sourceDirs` are rescanned for each build/watch compilation.
- Provider files and configured source directories are added to the bundler watch graph where the compiler exposes those dependency sets.
- Rebuilds regenerate the cache module before compilation, so imports from `virtual:alloy-container` see the latest discovered service graph.

## Current Limitations

- The webpack and Rspack adapters regenerate the container on rebuild; they do not hot-swap the DI graph inside a running page. If the service graph changes during development, refresh the browser after the rebuild completes.
- `alloy generate` loads JavaScript bundler config files (`.js`, `.mjs`, `.cjs`). TypeScript webpack/Rspack configs need a JavaScript wrapper, or you can pass `--config false` and call `generate()` from `alloy-di/generate` with explicit options.
- The adapters do not transpile TypeScript or styles. Keep using your bundler's normal loaders for `.ts`, `.tsx`, CSS, Sass, assets, and framework-specific transforms.

## CLI Options

```bash
alloy generate --bundler webpack --config webpack.config.mjs --mode development
alloy generate --bundler rspack --config rspack.config.mjs --mode production
```

- `--bundler` accepts `vite`, `webpack`, `rspack`, or `none`.
- `--mode` is passed to webpack/Rspack config functions and defaults to `production`.
- `--config false` skips config loading and is equivalent to `--bundler none`.

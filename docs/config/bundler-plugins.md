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
- Vite keeps its dedicated HMR path; webpack and Rspack prioritize rebuild correctness.
- TypeScript bundler configs are not loaded directly by `alloy generate`. Use a JavaScript config wrapper or pass `--config false` and provide options programmatically through `alloy-di/generate`.

## CLI Options

```bash
alloy generate --bundler webpack --config webpack.config.mjs --mode development
alloy generate --bundler rspack --config rspack.config.mjs --mode production
```

- `--bundler` accepts `vite`, `webpack`, `rspack`, or `none`.
- `--mode` is passed to webpack/Rspack config functions and defaults to `production`.
- `--config false` skips config loading and is equivalent to `--bundler none`.

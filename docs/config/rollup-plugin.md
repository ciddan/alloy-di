# Rollup / Rolldown Plugin Configuration

The Rollup plugin is used primarily for building **internal libraries** in a monorepo. It scans your library code for Alloy decorators and emits an `alloy.manifest.mjs` file.

## Usage

```typescript
// rolldown.config.ts (or rollup.config.js)
import { defineConfig } from "rolldown";
import { alloy } from "alloy-di/rollup";

export default defineConfig({
  input: "src/index.ts",
  plugins: [
    alloy({
      // options
    }),
  ],
});
```

## Options

### fileName

- **Type:** `string`
- **Default:** `"alloy.manifest.mjs"`

The name of the manifest file to emit. This file will be generated in the build output directory (e.g., `dist/alloy.manifest.mjs`).

### packageJsonPath

- **Type:** `string`
- **Default:** `path.resolve(process.cwd(), "package.json")`

Path to the `package.json` file. The plugin reads this to determine the package name, which is included in the manifest to ensure correct import paths in consuming applications.

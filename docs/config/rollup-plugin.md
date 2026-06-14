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

### scopes

- **Type:** `Record<string, { parent: string }>`
- **Default:** `{}`

Declares custom [hierarchical scopes](/guide/scopes) and their parent ordering for the library's own services. Each entry names a scope and its `parent` — either `"singleton"` or another declared scope. `parent` defaults to `"singleton"` when omitted.

```typescript
alloy({
  scopes: {
    session: {}, // parent defaults to "singleton"
    request: { parent: "session" },
  },
});
```

The plugin runs [scope-stability validation](/guide/scopes#build-time-scope-stability-validation) over the library's discovered services on every build: the base rule (a longer-lived service may not depend on a shorter-lived one - e.g. a singleton on a transient) always applies. Unlike the Vite plugin, the Rollup plugin emits no declaration files, so type-safe scope names are only generated in the consuming application that hosts the runtime container.

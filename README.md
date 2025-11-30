```
    ___    __    __    ______  __
   /   |  / /   / /   / __ \ \/ /
  / /| | / /   / /   / / / /\  / 
 / ___ |/ /___/ /___/ /_/ / / /  
/_/  |_/_____/_____/\____/ /_/ 
```

# Alloy Monorepo

A compile-time dependency injection (DI) system purpose-built for the Vite ecosystem. This monorepo contains:

- **`packages/alloy`** – Vite plugin + minimal runtime. For detailed documentation on its API and features, please see the [package README](./packages/alloy/README.md).
- **`packages/examples/app`** – Demonstrates service declaration, singleton vs transient scope, lazy/async dependency loading, and automatic code-splitting. For more details see the [app README](./packages/examples/app/README.md).
- **`packages/examples/library-internal`** – Example monorepo library using Alloy decorators directly, showing automatic service discovery. For more details see the [README](./packages/examples/library-internal/README.md).
- **`packages/examples/library-external`** – Example external library with plain classes, showing provider-based integration. For more details see the [README](./packages/examples/library-external/README.md).

## Monorepo Development

First, clone the repository and install dependencies using pnpm:

```bash
git clone git@gitlab-ncsa.ubisoft.org:connect/public-libraries/alloy.git
cd alloy
pnpm install
```

### Available Scripts

- **Build all packages:**

  ```bash
  pnpm build
  ```

- **Run the example app:**

  ```bash
  pnpm --filter example dev
  ```

- **Run tests for the `alloy` library:**

  ```bash
  pnpm --filter alloy-di test
  ```

- **Format and lint all packages:**
  ```bash
  pnpm format
  pnpm lint
  ```

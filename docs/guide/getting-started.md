# Getting Started

## Installation

```bash
pnpm add -D alloy-di
```

## Usage

### 1. Configure Vite

Add the `alloy` plugin to your `vite.config.ts` file.

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { alloy } from "alloy-di/vite";

export default defineConfig({
  plugins: [alloy()],
});
```

> **Note:** The Alloy plugin generates type definition files (`alloy-container.d.ts` and `alloy-manifests.d.ts`) in your source directory (default: `./src`). Add these to your `.gitignore`.

> [!TIP]
> The default Vite scaffold (`pnpm create vite@latest`) wires `"build": "tsc && vite build"`. Alloy writes its ambient declarations during `vite build`, so running `tsc` first can fail on fresh trees. Swap the order (`vite build && tsc`), or manually run `vite build` to generate the declarations first.

### 2. Declare Services

Use decorators from `alloy-di/runtime`.

**Singleton Service:**

```ts
// service-a.ts
import { Singleton } from "alloy-di/runtime";

@Singleton()
export class ServiceA {
  public value = "Hello from singleton ServiceA";
}
```

**Transient Service with Dependencies:**

```ts
// app-service.ts
import { Injectable, deps } from "alloy-di/runtime";
import { ServiceA } from "./service-a";

@Injectable(deps(ServiceA))
export class AppService {
  constructor(private serviceA: ServiceA) {}

  public getValue() {
    return `AppService gets: "${this.serviceA.value}"`;
  }
}
```

### 3. Bootstrap Your Application

Import the container from the virtual module.

```ts
// main.ts
import container, { serviceIdentifiers } from "virtual:alloy-container";

async function bootstrap() {
  // Resolve via identifier (recommended)
  const appService = await container.get(serviceIdentifiers.AppService);

  console.log(appService.getValue());
}

bootstrap();
```

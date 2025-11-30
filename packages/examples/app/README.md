# Alloy Example App

A React + Vite application demonstrating all major features of the Alloy dependency injection system.

## Overview

This example app showcases real-world usage of Alloy's compile-time DI system in a React application, including:

- Service declaration with decorators
- Singleton and transient lifecycle scopes
- Multiple lazy loading strategies
- Internal library consumption via manifests
- External library integration via providers
- Token-based value injection
- React Suspense integration for async service resolution
- Name-based service resolution

## Project Structure

```
src/
├── lib/
│   ├── service-a.ts           # Singleton service (basic example)
│   ├── app-service.ts          # Demonstrates token injection + external lib
│   ├── lazy-service.ts         # Service loaded lazily as a dependency
│   ├── consumer-service.ts     # Demonstrates Lazy() dependency
│   ├── analytics-consumer.ts   # Consumes internal library services
│   └── tokens.ts               # Token definitions (ApiBaseUrl)
├── providers.ts                # External library integration
├── App.tsx                     # React component with Suspense
└── main.tsx                    # Entry point
```

## Features Demonstrated

### 1. Basic Service Declaration

**Singleton Service** (`src/lib/service-a.ts`):

```typescript
import { Singleton } from "alloy-di/runtime";

@Singleton()
export class ServiceA {
  public value = "Hello from singleton ServiceA";
}
```

**Transient Service with Dependencies** (`src/lib/app-service.ts`):

```typescript
import { Injectable, deps } from "alloy-di/runtime";
import { ServiceA } from "./service-a";

@Injectable(deps(ServiceA))
export class AppService {
  constructor(private serviceA: ServiceA) {}
}
```

### 2. Token-Based Value Injection

**Define Token** (`src/lib/tokens.ts`):

```typescript
import { createToken } from "alloy-di/runtime";

export const ApiBaseUrl = createToken<string>("api-base-url");
```

**Provide Value** (`src/providers.ts`):

```typescript
import { asValue, defineProviders } from "alloy-di/runtime";
import { ApiBaseUrl } from "./lib/tokens";

export default defineProviders({
  values: [asValue(ApiBaseUrl, "https://api.example.com")],
});
```

**Inject Token**:

```typescript
@Injectable(deps(ApiBaseUrl))
export class AppService {
  constructor(private baseUrl: string) {}
}
```

### 3. Lazy Loading (Three Strategies)

#### a) Decorator-Level Lazy Dependencies

Load a specific dependency lazily:

```typescript
import { Injectable, Lazy, deps } from "alloy-di/runtime";

@Injectable(
  deps(Lazy(() => import("./lazy-service").then((m) => m.LazyService))),
)
export class ConsumerService {
  constructor(private lazyService: LazyService) {}
}
```

#### b) Provider-Based Lazy Services

External library loaded lazily:

```typescript
export const LoggerService = asLazyClass(
  () =>
    import("@alloy-di/example-library-external/logger").then((m) => m.Logger),
  {
    lifecycle: lifecycle.singleton(),
    deps: deps(ConsoleOutput),
    label: "LoggerService",
  },
);
```

#### c) Service-Level Factory Laziness

Entire service module deferred via plugin config (`vite.config.ts`):

```typescript
alloy({
  lazyServices: ["ReportingService", "AnalyticsService"],
});
```

Resolved by identifier to avoid importing the class:

```typescript
const reportingService = await container.get(
  serviceIdentifiers.ReportingService,
);
```

Using `serviceIdentifiers` keeps bundlers from seeing a direct constructor reference, which prevents factory-lazy services from being eagerly pulled into the main chunk. The constructor overload still exists for tests and Node-only scenarios, but expect a dev-only warning if you resolve a factory-lazy service by constructor so you know to switch to identifiers.

### 4. Internal Library Integration

The app consumes services from `@alloy-di/example-library-internal` via manifests:

**Configuration** (`vite.config.ts`):

```typescript
alloy({
  manifests: [
    "node_modules/@alloy-di/example-library-internal/dist/alloy.manifest.mjs",
  ],
});
```

**Usage**:

```typescript
import { EventTracker, UserSession } from "@alloy-di/example-library-internal";

@Injectable(deps(EventTracker, UserSession))
export class AnalyticsConsumer {
  constructor(
    private eventTracker: EventTracker,
    private userSession: UserSession,
  ) {}
}
```

### 5. External Library Integration

Plain classes from `@alloy-di/example-library-external` registered via providers:

```typescript
import { asClass, asLazyClass } from "alloy-di/runtime";
import { ConsoleOutput } from "@alloy-di/example-library-external/console-output";

export default defineProviders({
  services: [asClass(ConsoleOutput, { lifecycle: lifecycle.singleton() })],
  lazyServices: [
    asLazyClass(
      () =>
        import("@alloy-di/example-library-external/logger").then(
          (m) => m.Logger,
        ),
      { lifecycle: lifecycle.singleton(), deps: deps(ConsoleOutput) },
    ),
  ],
});
```

### 6. React Integration with Suspense

Alloy's async container resolution integrates naturally with React's Suspense:

```typescript
import { Suspense, use } from "react";
import container, { serviceIdentifiers } from "virtual:alloy-container";

const appServicePromise = container.get(serviceIdentifiers.AppService);

function AppContent() {
  const appService = use(appServicePromise);
  return <div>{appService.getValue()}</div>;
}

export function App() {
  return (
    <Suspense fallback={<div>Loading services…</div>}>
      <AppContent />
    </Suspense>
  );
}
```

Service resolution happens during Suspense boundary, enabling:

- Lazy service imports to be awaited
- Clean separation of DI from component logic
- Optimal code-splitting boundaries

## Running the Example

**Development server:**

```bash
pnpm dev
```

**Build for production:**

```bash
pnpm build
```

**Preview production build:**

```bash
pnpm preview
```

## Configuration

The `vite.config.ts` demonstrates complete Alloy configuration:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import alloy from "alloy-di";

export default defineConfig({
  plugins: [
    react(),
    alloy({
      // Provider modules for external libraries
      providers: ["src/providers.ts"],

      // Manifests from internal monorepo libraries
      manifests: [
        "node_modules/@alloy-di/example-library-internal/dist/alloy.manifest.mjs",
      ],

      // Services to load lazily at the factory level
      lazyServices: ["ReportingService", "AnalyticsService"],
    }),
  ],
});
```

## Key Takeaways

1. **Compile-time DI**: No runtime reflection or metadata overhead
2. **Type-safe**: Full TypeScript support with intellisense
3. **Code-splitting ready**: Multiple lazy loading strategies
4. **Flexible integration**: Works with both internal (manifest) and external (provider) libraries
5. **React-friendly**: Natural integration with Suspense for async services
6. **Production-ready**: Consistent behavior between dev and production builds

## Learn More

- **Main documentation**: https://alloy-di.dev/guide/getting-started
- **API reference**: https://alloy-di.dev/api/
- **Lazy loading guide**: https://alloy-di.dev/guide/lazy-loading
- **Internal library authoring**: https://alloy-di.dev/guide/libraries

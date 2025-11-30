# Example Internal Library

A sample internal monorepo library that demonstrates direct Alloy decorator usage. This library showcases how packages within your monorepo can use Alloy's DI system directly, with services automatically discovered by the plugin when consumed by other packages.

## Overview

This library provides analytics and session tracking functionality with four main services:

- **AnalyticsService**: A singleton that tracks application events
- **EventTracker**: A transient service providing convenient methods for tracking specific event types
- **UserSession**: A singleton that manages user session state
- **ReportingService**: A transient service demonstrating a Lazy dependency on `AnalyticsService`

## Key Difference: Internal vs External Libraries

**Internal libraries** (like this one) are part of your monorepo and can use Alloy decorators directly:

- Services use `@Injectable` or `@Singleton` decorators
- Library build emits an `alloy.manifest.mjs` file describing all services
- **No provider configuration needed** - services are available immediately when imported
- Dependencies between services are resolved automatically

**External libraries** (like `@alloy-di/example-library-external`) are third-party packages that don't use Alloy:

- Services are plain classes without decorators
- Require manual registration via `defineProviders()` in your app
- You must explicitly configure dependencies using `asClass` or `asLazyClass`

## Usage Example

**First, ensure the library build generates a manifest:**

```typescript
// rolldown.config.ts
import { alloyManifest } from "alloy-di";

export default defineConfig({
  input: { index: "src/index.ts" },
  plugins: [alloyManifest()],
});
```

After building, this creates `dist/alloy.manifest.mjs` alongside the compiled code.

**Then, configure your app to consume the manifest:**

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import alloy from "alloy-di";

export default defineConfig({
  plugins: [
    alloy({
      manifests: [
        "node_modules/@alloy-di/example-library-internal/dist/alloy.manifest.mjs",
      ],
    }),
  ],
});
```

**Finally, use the services in your application:**

```typescript
// In your application code
import {
  AnalyticsService,
  EventTracker,
  UserSession,
} from "@alloy-di/example-library-internal";
import { Injectable, deps } from "alloy-di/runtime";
import container from "virtual:alloy-container";

// Services from internal libraries are automatically discovered!
// Just import them and they work immediately.

@Injectable(deps(EventTracker, UserSession))
export class MyService {
  constructor(
    private tracker: EventTracker,
    private session: UserSession,
  ) {}

  doSomething() {
    this.session.startSession("user-123");
    this.tracker.trackPageView("dashboard");
  }
}

// Or resolve directly from the container
const analytics = await container.get(AnalyticsService);
analytics.track("app_started");
```

## Architecture

All services in this library use Alloy decorators:

1. **AnalyticsService** - `@Singleton()` - Core event tracking
2. **EventTracker** - `@Injectable(deps(AnalyticsService))` - Convenience methods for tracking
3. **UserSession** - `@Singleton(deps(AnalyticsService))` - Session management
4. **ReportingService** - `@Injectable(deps(Lazy(() => import('./analytics-service').then(m => m.AnalyticsService))))` - Demonstrates Lazy loading + retry metadata

## Lazy Dependency Example

```ts
import { Injectable, Lazy, deps } from "alloy-di/runtime";
import type { AnalyticsService } from "./analytics-service";

@Injectable(
  deps(
    Lazy(() => import("./analytics-service").then((m) => m.AnalyticsService), {
      retries: 2,
      backoffMs: 10,
    }),
  ),
)
export class ReportingService {
  constructor(private analytics: AnalyticsService) {}
  generateDailyReport() {
    this.analytics.track("daily_report_generated");
  }
}
```

The container resolves `AnalyticsService` only when `ReportingService` is constructed, allowing you to defer heavier dependencies until needed.

The manifest describes all services, their dependencies, and import paths. The consuming app's Alloy plugin reads this manifest and automatically registers all services in the generated container.

## Building

```bash
pnpm run build
```

This generates both the compiled code and the `dist/alloy.manifest.mjs` file.

## When to Use This Pattern

Use this pattern (internal library with manifest) when:

- You control the library source code (monorepo packages)
- You want automatic service discovery via build-time manifests
- You want type-safe dependency injection throughout your monorepo
- You're building a cohesive application with multiple packages
- You need consistent behavior in development and production

Use providers (external library pattern) when:

- Integrating third-party libraries
- Working with libraries that don't use Alloy
- You can't modify the library source

## Learn More

For a complete guide on authoring internal libraries with Alloy, including troubleshooting and best practices, visit https://alloy-di.dev/guide/libraries.

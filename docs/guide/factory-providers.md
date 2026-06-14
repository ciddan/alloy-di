# Factory Providers

Alloy's static discovery handles decorated classes, and the [provider
API](/api/#provider-api) (`asValue` / `asClass` / `asLazyClass`) covers classes
and values that live outside the decorator world. **Factory providers** fill the
remaining gap: a dependency whose construction needs arbitrary runtime logic —
reading `window` config, composing a third-party client, branching on the
environment.

A factory binds a function to a [`Token`](/api/#tokens-and-providers). The
function runs at resolution time, receives the resolving context, and its result
is injected wherever the token is declared as a dependency.

```ts
import { createToken } from "alloy-di/runtime";

export const ApiClientToken = createToken<ApiClient>("api-client");
```

## Declaring a factory

`asFactory` mirrors `asClass`: a token, a factory function, and a lifecycle. It
is collected under the `factories` field of `defineProviders`, alongside
`values`, `services`, and `lazyServices`.

```ts
// src/providers.ts
import {
  defineProviders,
  asFactory,
  asValue,
  lifecycle,
} from "alloy-di/runtime";
import { ApiClientToken, ConfigToken } from "./tokens";
import { ApiClient } from "./api-client";

export default defineProviders({
  values: [asValue(ConfigToken, loadConfig())],
  factories: [
    asFactory(
      ApiClientToken,
      (c) => new ApiClient({ endpoint: c.getToken(ConfigToken).apiEndpoint }),
      { lifecycle: lifecycle.singleton() },
    ),
  ],
});
```

Point the plugin at the provider module and the generated container applies it
for you:

```ts
// vite.config.ts
import { alloy } from "alloy-di/vite";

export default {
  plugins: [alloy({ providers: ["src/providers.ts"] })],
};
```

A service then declares the token like any other dependency:

```ts
import { Injectable, deps } from "alloy-di/runtime";
import { ApiClientToken } from "./tokens";

@Injectable(deps(ApiClientToken))
class UserService {
  constructor(private api: ApiClient) {}
}
```

The token's type checks the factory's return type at the `asFactory` call site,
so `ApiClientToken` (an `ApiClient` token) requires the factory to return an
`ApiClient`.

## Resolving dependencies inside a factory

The factory receives the resolving **context** — a small surface exposing
`get` and `getToken`. Use it to resolve other services or token values:

```ts
asFactory(
  ServiceToken,
  async (c) => new Service(await c.get(Config), c.getToken(ApiBaseUrl)),
  { lifecycle: lifecycle.singleton() },
);
```

Factories may be `async`. The container awaits the result before injecting it,
and concurrent first-resolutions of a cached factory are coalesced into a single
execution.

## Lifecycles

`options.lifecycle` controls when the factory runs and where its result is
cached:

| Lifecycle                         | Behaviour                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `lifecycle.singleton()`           | Runs once; result cached on the root container and reused everywhere.                       |
| `lifecycle.transient()`           | Runs on **every** resolution; nothing is cached.                                            |
| A custom scope (e.g. `"request"`) | Runs once per matching [scope](/guide/scopes) instance, cached there, and disposed with it. |

### Scoped factories

A factory bound to a custom scope produces one result per scope instance and
runs **against that scope**, so it sees scope-local providers:

```ts
asFactory(
  RequestContextToken,
  (c) => ({ user: c.getToken(CurrentUserToken) }),
  { lifecycle: "request" },
);
```

```ts
const request = session.createScope("request");
request.provideValue(CurrentUserToken, currentUser);

// The factory runs against `request`, so getToken(CurrentUserToken) resolves
// the value provided on that scope. The result is cached for the request and
// disposed when the request scope is disposed.
await request.get(SomeRequestService);
```

If a scoped factory is resolved where no matching scope is active (for example,
straight off the root container), it falls back to transient behaviour — it runs
without caching, mirroring how class resolution treats a custom scope with no
matching context.

If the factory result implements `Symbol.dispose` / `Symbol.asyncDispose` (or
`alloyOnDestroy`), it is torn down in reverse instantiation order when its scope
is disposed, just like a scoped class instance.

## Imperative registration

For cases where a factory must be registered dynamically rather than declared
statically, `container.provideFactory` backs the same machinery:

```ts
import container from "virtual:alloy-container";

container.provideFactory(ApiClientToken, (c) => new ApiClient(/* … */), {
  lifecycle: lifecycle.singleton(),
});
```

`asFactory` is the recommended default; `provideFactory` is the escape hatch.
Unlike `asFactory`, its `lifecycle` option is optional and defaults to
`singleton`. Re-registering a token replaces the previous factory and
invalidates any result already cached for it — on the root **and** in every
active scope.

## Testing

The [test container](/guide/testing) accepts factory overrides and exposes
imperative helpers. A token value override still wins over a factory for the
same token, so you can pin a concrete value without removing the factory.

```ts
import { createTestContainer } from "alloy-di/test";

const t = createTestContainer({
  overrides: {
    factories: [
      [ApiClientToken, () => new FakeApiClient(), { lifecycle: "singleton" }],
    ],
  },
});

// or after construction:
t.overrideFactory(ApiClientToken, () => new OtherFakeClient());
```

## Build-time visibility

A factory body is opaque to the static scanner — Alloy cannot see what a factory
resolves internally. To keep the [dependency graph](/guide/visualization)
honest, factories render as distinct **Factory Nodes**, visually separating them
from auto-discovered classes whose edges _are_ statically known. A service that
depends on a factory-bound token draws an edge to its Factory Node.

Because a factory carries a lifecycle, scope-stability is still checked across
that edge: a longer-lived service depending on a shorter-lived scoped factory (a
captive dependency) is flagged in the diagram, just as it would be for a class.

## Notes and limitations

- **Tokens with factories are resolved through injection, not `getToken`.**
  `container.getToken(token)` returns synchronous **value** providers only;
  calling it for a factory-bound token throws a descriptive error (factories may
  be async). Declare the token as a dependency instead.
- **Value providers take precedence.** If a token has both a value provider and
  a factory, the value wins at resolution time. This is what makes a token value
  override in tests shadow a factory.
- **Circular factories are caught when synchronous.** A factory that resolves
  its own token while it is still constructing — directly or mutually between
  factories — throws a clear `Circular factory dependency detected` error. A
  factory that re-enters its own token only **after** awaiting is
  indistinguishable from legitimate concurrent resolution and is not caught; it
  will deadlock. Restructure such a factory rather than relying on detection.

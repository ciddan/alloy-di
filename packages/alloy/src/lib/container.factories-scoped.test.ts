import { beforeEach, describe, expect, it } from "vitest";
import { Container } from "./container";
import { deps, Injectable } from "./decorators";
import { createScope } from "../scopes";
import { createToken } from "./types";

// Bypass the global AlloyScopes augmentation (absent in library tests) so custom
// scope names type-check where a ServiceScope is expected.
// oxlint-disable-next-line no-explicit-any -- Justified: test-only scope cast.
const s = (name: string): any => name;

/**
 * Custom-scope factory providers: a factory bound to a custom lifecycle runs
 * once per matching scope instance, caches its result there, resolves against
 * that scope, and is disposed with it. A transient consumer is used so that its
 * token dependency resolves in the scope the consumer is fetched from.
 */
describe("Factory providers (custom scopes)", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    container._registerScopeHierarchy({
      session: "singleton",
      request: "session",
    });
  });

  it("caches the factory result once per scope instance", async () => {
    const Token = createToken<{ id: number }>("req-scoped");
    let calls = 0;
    container.provideFactory(Token, () => ({ id: ++calls }), {
      lifecycle: s("request"),
    });

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: { id: number }) {}
    }

    const session = createScope(container, s("session"));
    const req1 = createScope(session, s("request"));

    const a1 = await req1.get(Consumer);
    const a2 = await req1.get(Consumer);
    // Same factory result within one request scope (consumer is transient, so
    // a1 !== a2, but they share the cached value).
    expect(a1).not.toBe(a2);
    expect(a1.value).toBe(a2.value);
    expect(calls).toBe(1);

    const req2 = createScope(session, s("request"));
    const b = await req2.get(Consumer);
    // A second request scope gets its own factory result.
    expect(b.value).not.toBe(a1.value);
    expect(calls).toBe(2);
  });

  it("resolves the factory against its scope (sees scope-local providers)", async () => {
    const UserToken = createToken<string>("current-user");
    const GreetingToken = createToken<string>("greeting");
    container.provideFactory(
      GreetingToken,
      (c) => `hello ${c.getToken(UserToken)}`,
      { lifecycle: s("request") },
    );

    @Injectable(deps(GreetingToken))
    class Consumer {
      constructor(public greeting: string) {}
    }

    const session = createScope(container, s("session"));
    const req = createScope(session, s("request"));
    // Value provided only on the request scope — reachable only if the factory
    // runs against the scope, not the root container.
    req.provideValue(UserToken, "alice");

    const resolved = await req.get(Consumer);
    expect(resolved.greeting).toBe("hello alice");
  });

  it("disposes the scoped factory result when the scope is disposed", async () => {
    const log: string[] = [];
    const Token = createToken<Disposable>("disposable-factory");
    container.provideFactory(
      Token,
      () => ({
        [Symbol.dispose]() {
          log.push("disposed");
        },
      }),
      { lifecycle: s("request") },
    );

    @Injectable(deps(Token))
    class Consumer {
      constructor(public resource: Disposable) {}
    }

    const session = createScope(container, s("session"));
    const req = createScope(session, s("request"));
    await req.get(Consumer);

    expect(log).toEqual([]);
    await req.dispose();
    expect(log).toEqual(["disposed"]);
  });

  it("falls back to transient when no matching scope is active", async () => {
    const Token = createToken<number>("req-without-scope");
    let calls = 0;
    container.provideFactory(Token, () => ++calls, {
      lifecycle: s("request"),
    });

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: number) {}
    }

    // Resolved straight off the root container: no request scope in the chain,
    // so the factory re-runs on every resolution.
    await container.get(Consumer);
    await container.get(Consumer);
    expect(calls).toBe(2);
  });

  it("invalidates an already-cached scope value when the factory is re-registered", async () => {
    const Token = createToken<number>("reregister-scoped");
    container.provideFactory(Token, () => 1, { lifecycle: s("request") });

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: number) {}
    }

    const session = createScope(container, s("session"));
    const req = createScope(session, s("request"));

    // Cache the first value in this live request scope...
    expect((await req.get(Consumer)).value).toBe(1);

    // ...then re-register. The new generation must invalidate the value already
    // cached in the active scope, which root-only clearing could not reach.
    container.provideFactory(Token, () => 2, { lifecycle: s("request") });
    expect((await req.get(Consumer)).value).toBe(2);
  });

  it("resolves the same scoped factory concurrently in sibling scopes without a false cycle", async () => {
    const Token = createToken<{ id: number }>("concurrent-scoped");
    let calls = 0;
    container.provideFactory(
      Token,
      async () => {
        await Promise.resolve();
        return { id: ++calls };
      },
      { lifecycle: s("request") },
    );

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: { id: number }) {}
    }

    const session = createScope(container, s("session"));
    const req1 = createScope(session, s("request"));
    const req2 = createScope(session, s("request"));

    // The descriptor's re-entrancy guard is shared; concurrent resolutions in
    // separate scopes must each run the factory, not trip the cycle guard.
    const [a, b] = await Promise.all([req1.get(Consumer), req2.get(Consumer)]);
    expect(calls).toBe(2);
    expect(a.value).not.toBe(b.value);
  });

  it("shares a singleton factory result across sibling scopes", async () => {
    const Token = createToken<symbol>("singleton-across-scopes");
    let calls = 0;
    container.provideFactory(
      Token,
      () => {
        calls++;
        return Symbol("once");
      },
      { lifecycle: s("singleton") },
    );

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: symbol) {}
    }

    const session = createScope(container, s("session"));
    const req1 = createScope(session, s("request"));
    const req2 = createScope(session, s("request"));

    const a = await req1.get(Consumer);
    const b = await req2.get(Consumer);
    expect(a.value).toBe(b.value);
    expect(calls).toBe(1);
  });
});

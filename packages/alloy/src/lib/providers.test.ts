import { describe, expect, it } from "vitest";
import { Container } from "./container";
import { createToken } from "./types";
import { deps } from "./decorators";
import {
  applyProviders,
  asClass,
  asFactory,
  asLazyClass,
  asValue,
  defineProviders,
  lifecycle,
} from "./providers";
import { ServiceScope } from "./scope";

class DepService {}
class NeedsDep {
  constructor(
    public dep: DepService,
    public baseUrl: string,
  ) {}
}

describe("provider helpers", () => {
  it("registers values and services on a container", async () => {
    const apiToken = createToken<string>("api-base-url");
    const definition = defineProviders({
      values: [asValue(apiToken, "https://api.example.com")],
      services: [
        asClass(DepService, { lifecycle: lifecycle.singleton() }),
        asClass(NeedsDep, {
          lifecycle: lifecycle.transient(),
          deps: deps(DepService, apiToken),
        }),
      ],
    });

    const container = new Container();
    applyProviders(container, definition);

    const resolved = await container.get(NeedsDep);
    expect(resolved.dep).toBeInstanceOf(DepService);
    expect(await container.get(NeedsDep)).not.toBe(resolved);
    expect(await container.get(DepService)).toBe(
      await container.get(DepService),
    );
    expect(resolved.dep).toBe(await container.get(DepService));
    expect(resolved.baseUrl).toBe("https://api.example.com");
  });

  it("accepts arrays of provider definitions", async () => {
    const container = new Container();
    class Scoped {}
    const definitionA = defineProviders({
      services: [asClass(Scoped, { lifecycle: lifecycle.singleton() })],
    });
    const definitionB = defineProviders({});
    applyProviders(container, [definitionA, definitionB]);
    expect(await container.get(Scoped)).toBe(await container.get(Scoped));
  });

  it("registers lazy services that load constructors on demand", async () => {
    class RealLazyService {
      constructor(public baseUrl: string) {}
    }

    const baseUrlToken = createToken<string>("lazy-base-url");
    const LazyService = asLazyClass(async () => RealLazyService, {
      lifecycle: lifecycle.singleton(),
      deps: deps(baseUrlToken),
      label: "LazyService",
    });

    const definition = defineProviders({
      values: [asValue(baseUrlToken, "https://lazy.example.com")],
      lazyServices: [LazyService],
    });

    const container = new Container();
    applyProviders(container, definition);

    const instance = await container.get(LazyService);
    expect(instance).toBeInstanceOf(RealLazyService);
    expect(instance.baseUrl).toBe("https://lazy.example.com");
    expect(await container.get(LazyService)).toBe(instance);
  });

  it("does not eagerly evaluate thunk deps during cycle detection", async () => {
    class A {}
    class B {}

    const defs = defineProviders({
      services: [
        asClass(A, { lifecycle: lifecycle.transient(), deps: () => [B] }),
        asClass(B, { lifecycle: lifecycle.transient(), deps: [A] }),
      ],
    });

    const container = new Container();
    // Prior behavior would throw on cycle detection by invoking the thunk.
    // New behavior skips thunk deps in detection, so registration succeeds.
    expect(() => applyProviders(container, defs)).not.toThrow();
  });
});

describe("factory providers (declarative)", () => {
  it("registers a factory via the factories field and injects its result", async () => {
    const ConfigToken = createToken<{ endpoint: string }>("cfg");
    const ClientToken = createToken<{ url: string }>("client");

    class Consumer {
      constructor(public client: { url: string }) {}
    }

    const definition = defineProviders({
      values: [asValue(ConfigToken, { endpoint: "https://api.example.com" })],
      factories: [
        // Factory reads another provided value off the container.
        asFactory(
          ClientToken,
          (c) => ({ url: c.getToken(ConfigToken).endpoint }),
          { lifecycle: lifecycle.singleton() },
        ),
      ],
      services: [
        asClass(Consumer, {
          lifecycle: lifecycle.transient(),
          deps: deps(ClientToken),
        }),
      ],
    });

    const container = new Container();
    applyProviders(container, definition);

    const resolved = await container.get(Consumer);
    expect(resolved.client.url).toBe("https://api.example.com");
  });

  it("threads lifecycle through applyProviders (singleton caches, transient re-runs)", async () => {
    const SingletonToken = createToken<{ id: number }>("singleton-token");
    const TransientToken = createToken<{ id: number }>("transient-token");

    let singletonCalls = 0;
    let transientCalls = 0;

    class NeedsSingleton {
      constructor(public value: { id: number }) {}
    }
    class NeedsTransient {
      constructor(public value: { id: number }) {}
    }

    const definition = defineProviders({
      factories: [
        asFactory(SingletonToken, () => ({ id: ++singletonCalls }), {
          lifecycle: lifecycle.singleton(),
        }),
        asFactory(TransientToken, () => ({ id: ++transientCalls }), {
          lifecycle: lifecycle.transient(),
        }),
      ],
      services: [
        asClass(NeedsSingleton, {
          lifecycle: lifecycle.transient(),
          deps: deps(SingletonToken),
        }),
        asClass(NeedsTransient, {
          lifecycle: lifecycle.transient(),
          deps: deps(TransientToken),
        }),
      ],
    });

    const container = new Container();
    applyProviders(container, definition);

    await container.get(NeedsSingleton);
    await container.get(NeedsSingleton);
    await container.get(NeedsTransient);
    await container.get(NeedsTransient);

    expect(singletonCalls).toBe(1);
    expect(transientCalls).toBe(2);
  });

  it("lifecycle helpers map to the underlying ServiceScope values", () => {
    const token = createToken<number>("scope-check");
    const singleton = asFactory(token, () => 1, {
      lifecycle: lifecycle.singleton(),
    });
    const transient = asFactory(token, () => 1, {
      lifecycle: lifecycle.transient(),
    });

    expect(singleton.kind).toBe("factory");
    expect(singleton.lifecycle).toBe(ServiceScope.SINGLETON);
    expect(transient.lifecycle).toBe(ServiceScope.TRANSIENT);
  });
});

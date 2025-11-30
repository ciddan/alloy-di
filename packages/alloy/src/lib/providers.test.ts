import { describe, expect, it } from "vitest";
import { Container } from "./container";
import { createToken } from "./types";
import { deps } from "./decorators";
import {
  applyProviders,
  asClass,
  asLazyClass,
  asValue,
  defineProviders,
  lifecycle,
} from "./providers";

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

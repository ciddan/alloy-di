import { describe, expect, it, vi } from "vitest";
import { Container } from "./container";
import { deps, Injectable } from "./decorators";
import { ServiceScope } from "./scope";
import { createToken } from "./types";

/**
 * Container-level engine tests for token-bound factory providers
 * (`provideFactory` + the factory path in `resolveTokenLike`). The declarative
 * `asFactory` surface is covered separately in `providers.test.ts`.
 */
describe("Factory providers (container engine)", () => {
  it("defaults to singleton: runs once and caches the value", async () => {
    const Token = createToken<{ id: number }>("singleton-factory");
    const container = new Container();

    const fn = vi.fn(() => ({ id: Math.random() }));
    container.provideFactory(Token, fn);

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: { id: number }) {}
    }

    const first = await container.get(Consumer);
    const second = await container.get(Consumer);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(first.value).toBe(second.value);
  });

  it("transient: re-executes on every resolution", async () => {
    const Token = createToken<number>("transient-factory");
    const container = new Container();

    let counter = 0;
    const fn = vi.fn(() => ++counter);
    container.provideFactory(Token, fn, {
      lifecycle: ServiceScope.TRANSIENT,
    });

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: number) {}
    }

    const a = await container.get(Consumer);
    const b = await container.get(Consumer);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(a.value).toBe(1);
    expect(b.value).toBe(2);
  });

  it("supports async factories and injects the resolved value", async () => {
    const Token = createToken<string>("async-factory");
    const container = new Container();

    container.provideFactory(Token, async () => {
      await Promise.resolve();
      return "resolved";
    });

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: string) {}
    }

    const instance = await container.get(Consumer);
    expect(instance.value).toBe("resolved");
  });

  it("coalesces concurrent singleton resolutions into one execution", async () => {
    const Token = createToken<symbol>("coalesced-factory");
    const container = new Container();

    const fn = vi.fn(async () => {
      await Promise.resolve();
      return Symbol("instance");
    });
    container.provideFactory(Token, fn);

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: symbol) {}
    }

    const [a, b, c] = await Promise.all([
      container.get(Consumer),
      container.get(Consumer),
      container.get(Consumer),
    ]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(a.value).toBe(b.value);
    expect(b.value).toBe(c.value);
  });

  it("receives the container and can resolve its own dependencies", async () => {
    const ConfigToken = createToken<{ endpoint: string }>("config");
    const ClientToken = createToken<{ endpoint: string }>("client");
    const container = new Container();

    container.provideValue(ConfigToken, { endpoint: "https://api.local" });
    container.provideFactory(ClientToken, (c) => ({
      endpoint: c.getToken(ConfigToken).endpoint,
    }));

    @Injectable(deps(ClientToken))
    class Consumer {
      constructor(public client: { endpoint: string }) {}
    }

    const instance = await container.get(Consumer);
    expect(instance.client.endpoint).toBe("https://api.local");
  });

  it("caches a factory that resolves to undefined (explicit cached flag)", async () => {
    const Token = createToken<undefined>("undefined-factory");
    const container = new Container();

    const fn = vi.fn(() => undefined);
    container.provideFactory(Token, fn);

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: undefined) {}
    }

    await container.get(Consumer);
    await container.get(Consumer);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("value providers take precedence over a factory for the same token", async () => {
    const Token = createToken<string>("shadowed-factory");
    const container = new Container();

    const fn = vi.fn(() => "from-factory");
    container.provideFactory(Token, fn);
    container.provideValue(Token, "from-value");

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: string) {}
    }

    const instance = await container.get(Consumer);
    expect(instance.value).toBe("from-value");
    expect(fn).not.toHaveBeenCalled();
  });

  it("clears pending on rejection so a failed singleton factory can retry", async () => {
    const Token = createToken<string>("retry-factory");
    const container = new Container();

    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error("transient failure");
      }
      return "recovered";
    });
    container.provideFactory(Token, fn);

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: string) {}
    }

    await expect(container.get(Consumer)).rejects.toThrow("transient failure");

    const instance = await container.get(Consumer);
    expect(instance.value).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the standard token error when neither value nor factory exists", async () => {
    const Token = createToken<string>("missing-everything");
    const container = new Container();

    @Injectable(deps(Token))
    class Consumer {
      constructor(public value: string) {}
    }

    await expect(container.get(Consumer)).rejects.toThrow(
      /No provider registered for token/,
    );
  });

  describe("getToken() interaction", () => {
    it("throws a factory-specific error when getToken hits a factory token", () => {
      const Token = createToken<string>("factory-via-getToken");
      const container = new Container();
      container.provideFactory(Token, () => "value");

      expect(() => container.getToken(Token)).toThrow(
        /registered as a factory provider.*cannot be retrieved synchronously/,
      );
    });

    it("still resolves a value provider via getToken when both exist", () => {
      const Token = createToken<string>("value-wins-getToken");
      const container = new Container();
      container.provideFactory(Token, () => "from-factory");
      container.provideValue(Token, "from-value");

      expect(container.getToken(Token)).toBe("from-value");
    });
  });

  describe("circular factory detection", () => {
    it("throws a circular error for a singleton factory that depends on its own token", async () => {
      const Token = createToken<string>("self-cycle-singleton");
      const container = new Container();

      // Mid depends on Token, and Token's factory resolves Mid — so the factory
      // re-enters its own token through the resolution path while constructing.
      @Injectable(deps(Token))
      class Mid {
        constructor(public value: string) {}
      }
      container.provideFactory(Token, async (c) => (await c.get(Mid)).value);

      await expect(container.get(Mid)).rejects.toThrow(
        /Circular factory dependency detected/,
      );
    });

    it("throws a circular error for a mutual cycle between two factories", async () => {
      const TokenA = createToken<string>("cycle-a");
      const TokenB = createToken<string>("cycle-b");
      const container = new Container();

      @Injectable(deps(TokenB))
      class NeedsB {
        constructor(public value: string) {}
      }
      @Injectable(deps(TokenA))
      class NeedsA {
        constructor(public value: string) {}
      }

      container.provideFactory(
        TokenA,
        async (c) => `a:${(await c.get(NeedsB)).value}`,
      );
      container.provideFactory(
        TokenB,
        async (c) => `b:${(await c.get(NeedsA)).value}`,
      );

      @Injectable(deps(TokenA))
      class Consumer {
        constructor(public value: string) {}
      }

      await expect(container.get(Consumer)).rejects.toThrow(
        /Circular factory dependency detected/,
      );
    });

    it("does not mistake legitimate singleton coalescing for a cycle", async () => {
      const Token = createToken<symbol>("coalesce-not-cycle");
      const container = new Container();

      const fn = vi.fn(async () => {
        await Promise.resolve();
        return Symbol("ok");
      });
      container.provideFactory(Token, fn);

      @Injectable(deps(Token))
      class Consumer {
        constructor(public value: symbol) {}
      }

      // Many concurrent resolutions land on the in-flight pending promise; the
      // guard must not flag them as re-entrancy.
      const results = await Promise.all(
        Array.from({ length: 5 }, () => container.get(Consumer)),
      );

      expect(fn).toHaveBeenCalledTimes(1);
      for (const r of results) {
        expect(r.value).toBe(results[0].value);
      }
    });
  });
});

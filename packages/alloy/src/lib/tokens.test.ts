import { deps, Injectable } from "./decorators";
import { describe, expect, it } from "vitest";
import { Container } from "./container";
import { createToken } from "./types";

describe("Token value providers (Option A, value-only)", () => {
  it("resolves provided values by token", async () => {
    const TOKEN = createToken<string>("api-url");
    const container = new Container();

    container.provideValue(TOKEN, "https://service.local");

    @Injectable(deps(TOKEN))
    class NeedsUrl {
      constructor(public url: string) {}
    }

    const instance = await container.get(NeedsUrl);
    expect(instance.url).toBe("https://service.local");
  });

  it("throws when token is not provided", async () => {
    const TOKEN = createToken<string>("missing");
    const container = new Container();

    @Injectable(deps(TOKEN))
    class NeedsMissing {
      constructor(public url: string) {}
    }

    await expect(container.get(NeedsMissing)).rejects.toThrow(
      /No provider registered for token/,
    );
  });
});

import { describe, it, expect } from "vitest";
import { dependenciesRegistry, Injectable } from "./decorators";
import { Container } from "./container";
import { Lazy } from "./lazy";
import type { ServiceIdentifier } from "./service-identifiers";

describe("Container identifiers", () => {
  it("resolves an eagerly registered service via identifier", async () => {
    @Injectable()
    class Alpha {}
    const container = new Container();
    const identifier = container.getIdentifier<Alpha>(Alpha);
    const instance = await container.getByIdentifier<Alpha>(identifier);
    expect(instance).toBeInstanceOf(Alpha);
  });

  it("resolves a factory-lazy service via identifier", async () => {
    class Beta {}
    // Simulate factory-lazy registration metadata (as codegen would do)
    dependenciesRegistry.set(Beta, {
      scope: "transient",
      dependencies: () => [],
      // Lazy factory returns a constructor
      factory: Lazy(() => Promise.resolve({ default: Beta })) as any,
    });
    const container = new Container();
    const identifier = container.getIdentifier<Beta>(Beta as any);
    const instance = await container.getByIdentifier<Beta>(identifier);
    expect(instance).toBeInstanceOf(Beta);
  });

  it("throws for unknown service identifier", async () => {
    const container = new Container();
    const missingIdentifier = Symbol("missing") as ServiceIdentifier;
    await expect(container.getByIdentifier(missingIdentifier)).rejects.toThrow(
      /No service registered/,
    );
  });
});

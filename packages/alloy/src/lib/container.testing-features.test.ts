import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Container } from "./container";
import { Injectable, dependenciesRegistry } from "./decorators";

type RegistryEntry = Parameters<(typeof dependenciesRegistry)["set"]>;

describe("Container testing features", () => {
  let baselineRegistry: RegistryEntry[];

  beforeEach(() => {
    baselineRegistry = Array.from(dependenciesRegistry.entries());
    dependenciesRegistry.clear();
  });

  afterEach(() => {
    dependenciesRegistry.clear();
    for (const [ctor, meta] of baselineRegistry) {
      dependenciesRegistry.set(ctor, meta);
    }
    vi.restoreAllMocks();
  });

  describe("overrideInstance", () => {
    it("injects overridden dependencies when resolving upstream services", async () => {
      @Injectable()
      class Engine {
        start() {
          return "original";
        }
      }

      @Injectable([Engine])
      class Car {
        constructor(public engine: Engine) {}

        run() {
          return this.engine.start();
        }
      }

      const container = new Container();
      const startSpy = vi.fn().mockReturnValue("mocked-engine");
      const mockedEngine: Engine = {
        start: startSpy,
      } as unknown as Engine;

      container.overrideInstance(Engine, mockedEngine);

      const car = await container.get(Car);

      expect(car.engine).toBe(mockedEngine);
      expect(car.run()).toBe("mocked-engine");
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("allows overriding the target service itself without instantiating dependencies", async () => {
      const dependencyConstructed = vi.fn();

      @Injectable()
      class Dependency {
        constructor() {
          dependencyConstructed();
        }
      }

      @Injectable([Dependency])
      class Subject {
        constructor(public dependency: Dependency) {}
      }

      const container = new Container();
      const stub: Subject = {
        dependency: {} as Dependency,
      } as Subject;

      container.overrideInstance(Subject, stub);

      const resolved = await container.get(Subject);

      expect(resolved).toBe(stub);
      expect(dependencyConstructed).not.toHaveBeenCalled();
    });

    it("shares overrides across constructor and identifier-based resolution", async () => {
      @Injectable()
      class Service {}

      const container = new Container();
      const fake: Service = {} as Service;

      container.overrideInstance(Service, fake);

      const identifier = container.getIdentifier(Service);
      const viaConstructor = await container.get(Service);
      const viaIdentifier = await container.getByIdentifier(identifier);

      expect(viaConstructor).toBe(fake);
      expect(viaIdentifier).toBe(fake);
    });

    it("replaces cached singleton instances when an override is provided", async () => {
      @Injectable("singleton")
      class Config {
        value = Math.random();
      }

      const container = new Container();
      const original = await container.get(Config);
      const replacement: Config = { value: 42 } as Config;

      container.overrideInstance(Config, replacement);

      const next = await container.get(Config);
      const again = await container.get(Config);

      expect(original).not.toBe(replacement);
      expect(next).toBe(replacement);
      expect(again).toBe(replacement);
    });
  });
});

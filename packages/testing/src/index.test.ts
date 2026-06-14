import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createToken, dependenciesRegistry } from "alloy-di/runtime";
import { createTestContainer } from "./index";

type RegistryEntry = Parameters<(typeof dependenciesRegistry)["set"]>;

// These tests exercise the runner-neutral core directly, without any adapter,
// to prove it has no Vitest dependency of its own.
describe("runner-neutral core", () => {
  let baseline: RegistryEntry[];

  beforeEach(() => {
    baseline = Array.from(dependenciesRegistry.entries()) as RegistryEntry[];
  });

  afterEach(() => {
    dependenciesRegistry.clear();
    for (const [ctor, meta] of baseline) {
      dependenciesRegistry.set(ctor, meta);
    }
  });

  it("applies manual token overrides without any runner adapter", () => {
    const TOKEN = createToken<string>("greeting");
    const test = createTestContainer({
      overrides: { tokens: [[TOKEN, "hello"]] },
    });
    expect(test.getToken(TOKEN)).toBe("hello");
    test.restore();
  });

  it("applies manual instance overrides without any runner adapter", async () => {
    class Service {
      value() {
        return "real";
      }
    }
    dependenciesRegistry.set(Service, { dependencies: () => [] });

    const fake = { value: () => "fake" };
    const test = createTestContainer({
      overrides: { instances: [[Service, fake]] },
    });

    const resolved = await test.get(Service);
    expect(resolved.value()).toBe("fake");
    test.restore();
  });

  it("keeps the legacy direct OverrideSpec shape working", () => {
    const TOKEN = createToken<string>("legacy");
    const test = createTestContainer({ tokens: [[TOKEN, "legacy-value"]] });
    expect(test.getToken(TOKEN)).toBe("legacy-value");
    test.restore();
  });

  it("throws when autoMock is enabled without a mockFn binding", () => {
    class Target {}
    dependenciesRegistry.set(Target, { dependencies: () => [] });

    expect(() =>
      createTestContainer({ autoMock: true, target: Target }),
    ).toThrow(/mockFn/);
  });

  it("supports a caller-supplied mockFn in the neutral core", () => {
    class Dep {
      run() {
        return "real";
      }
    }
    class Target {
      constructor(public dep: Dep) {}
    }
    dependenciesRegistry.set(Dep, { dependencies: () => [] });
    dependenciesRegistry.set(Target, { dependencies: () => [Dep] });

    let created = 0;
    const test = createTestContainer({
      autoMock: true,
      target: Target,
      mockFn: () => {
        created += 1;
        return () => undefined;
      },
    });

    expect(test.getMock(Dep)).toBeDefined();
    expect(created).toBeGreaterThan(0);
    test.restore();
  });
});

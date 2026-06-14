import { afterAll, describe, expect, it } from "@jest/globals";

import { asClass, dependenciesRegistry, lifecycle } from "alloy-di/runtime";
import { createTestContainer, setupAlloyTesting } from "../adapters/jest";

describe("jest adapter", () => {
  const handles: Array<{ restore(): void }> = [];

  afterAll(() => {
    for (const handle of handles.splice(0)) {
      handle.restore();
    }
  });

  it("creates jest mock spies for auto-mocked dependencies", async () => {
    class Dep {
      run() {
        return "real";
      }
    }
    class Target {
      constructor(public dep: Dep) {}
    }

    const test = createTestContainer({
      autoMock: true,
      target: Target,
      providers: {
        services: [
          asClass(Dep, { lifecycle: lifecycle.transient() }),
          asClass(Target, {
            lifecycle: lifecycle.transient(),
            deps: [Dep],
          }),
        ],
      },
    });
    handles.push(test);

    const target = await test.get(Target);
    const depMock = test.getMock(Dep);
    expect(depMock).toBeDefined();

    target.dep.run?.();

    const runSpy = test.spyOf(Dep, "run");
    expect(runSpy).toBeDefined();
    expect(runSpy?.mock.calls.length).toBe(1);

    test.clearMockSpies();
    expect(runSpy?.mock.calls.length).toBe(0);
  });
});

describe("jest setupAlloyTesting auto-cleanup", () => {
  const alloyTesting = setupAlloyTesting();
  class Tracked {}

  it("registers providers within a test", () => {
    expect(dependenciesRegistry.has(Tracked)).toBe(false);

    alloyTesting.createTestContainer({
      providers: {
        services: [asClass(Tracked, { lifecycle: lifecycle.transient() })],
      },
    });

    expect(dependenciesRegistry.has(Tracked)).toBe(true);
  });

  it("auto-restored the previous test's registry mutations", () => {
    expect(dependenciesRegistry.has(Tracked)).toBe(false);
  });
});

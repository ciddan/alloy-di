// oxlint-disable no-floating-promises -- node:test describe/it return promises the runner manages.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asClass, dependenciesRegistry, lifecycle } from "alloy-di/runtime";
import { createTestContainer, setupAlloyTesting } from "../adapters/node";

describe("node:test adapter", () => {
  it("creates node:test mock spies for auto-mocked dependencies", async () => {
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

    const target = await test.get(Target);
    const depMock = test.getMock(Dep);
    assert.ok(depMock, "expected an auto-mock for Dep");

    target.dep.run?.();

    const runSpy = test.spyOf(Dep, "run");
    assert.ok(runSpy, "expected a spy for Dep.run");
    assert.equal(runSpy.mock.calls.length, 1);

    test.clearMockSpies();
    assert.equal(runSpy.mock.calls.length, 0);

    test.restore();
  });
});

describe("node:test setupAlloyTesting auto-cleanup", () => {
  const alloyTesting = setupAlloyTesting();
  class Tracked {}

  it("registers providers within a test", () => {
    assert.equal(dependenciesRegistry.has(Tracked), false);

    alloyTesting.createTestContainer({
      providers: {
        services: [asClass(Tracked, { lifecycle: lifecycle.transient() })],
      },
    });

    assert.equal(dependenciesRegistry.has(Tracked), true);
  });

  it("auto-restored the previous test's registry mutations", () => {
    assert.equal(dependenciesRegistry.has(Tracked), false);
  });
});

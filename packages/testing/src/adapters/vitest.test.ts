import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  asClass,
  asFactory,
  asValue,
  dependenciesRegistry,
  lifecycle,
} from "alloy-di/runtime";
import { createTestContainer, createToken, setupAlloyTesting } from "./vitest";

// Bypass global scope augmentation in library tests.
// oxlint-disable-next-line no-explicit-any -- test-only custom scope cast.
const s = (name: string): any => name;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined.`);
  }
  return value;
}

describe("vitest createTestContainer core functionality", () => {
  const handles: Array<{ restore(): void }> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) {
      handle.restore();
    }
  });

  it("applies provider definitions and resolves by constructor or identifier", async () => {
    const ConfigToken = createToken<{ mode: string }>("config");

    class Dependency {
      public readonly name = "dependency";
    }
    class Subject {
      constructor(
        public config: { mode: string },
        public dependency: Dependency,
      ) {}
    }

    const handle = createTestContainer({
      providers: {
        values: [asValue(ConfigToken, { mode: "test" })],
        services: [
          asClass(Dependency, { lifecycle: lifecycle.singleton() }),
          asClass(Subject, {
            lifecycle: lifecycle.transient(),
            deps: [ConfigToken, Dependency],
          }),
        ],
      },
    });
    handles.push(handle);

    const identifier = required(
      handle.getIdentifier?.(Subject),
      "service identifier",
    );
    const byConstructor = await handle.get(Subject);
    const byIdentifier = await handle.get(identifier);

    expect(byConstructor.config.mode).toBe("test");
    expect(byConstructor.dependency.name).toBe("dependency");
    expect(byIdentifier).toBeInstanceOf(Subject);
    expect(byIdentifier.dependency).toBe(byConstructor.dependency);
    expect(handle.getToken(ConfigToken)).toEqual({ mode: "test" });
  });

  it("applies token overrides and supports provideToken after construction", () => {
    const ConfigToken = createToken<string>("config-override");

    const handle = createTestContainer({
      providers: {
        values: [asValue(ConfigToken, "provider")],
      },
      overrides: {
        tokens: [[ConfigToken, "override"]],
      },
    });
    handles.push(handle);

    expect(handle.getToken(ConfigToken)).toBe("override");

    handle.provideToken(ConfigToken, "later");
    expect(handle.getToken(ConfigToken)).toBe("later");
  });

  it("applies instance overrides when resolving upstream services", async () => {
    class Engine {
      start() {
        return "real";
      }
    }
    class Car {
      constructor(public engine: Engine) {}
    }

    const fakeEngine: Engine = {
      start: () => "fake",
    };

    const handle = createTestContainer({
      providers: {
        services: [
          asClass(Engine, { lifecycle: lifecycle.transient() }),
          asClass(Car, {
            lifecycle: lifecycle.transient(),
            deps: [Engine],
          }),
        ],
      },
      overrides: {
        instances: [[Engine, fakeEngine]],
      },
    });
    handles.push(handle);

    const car = await handle.get(Car);

    expect(car.engine).toBe(fakeEngine);
    expect(car.engine.start()).toBe("fake");
  });

  it("keeps the legacy direct OverrideSpec shape working", () => {
    const Token = createToken<string>("legacy-token");

    const handle = createTestContainer({
      tokens: [[Token, "legacy-value"]],
    });
    handles.push(handle);

    expect(handle.getToken(Token)).toBe("legacy-value");
  });

  it("exposes autoMock helpers backed by Vitest spies", async () => {
    class Leaf {
      ping() {
        return "leaf";
      }
    }
    class Branch {
      grow() {
        return "branch";
      }
    }
    class Target {
      constructor(
        public branch: Branch,
        public leaf: Leaf,
      ) {}
    }

    const handle = createTestContainer({
      autoMock: true,
      target: Target,
      providers: {
        services: [
          asClass(Leaf, { lifecycle: lifecycle.transient() }),
          asClass(Branch, { lifecycle: lifecycle.transient() }),
          asClass(Target, {
            lifecycle: lifecycle.transient(),
            deps: [Branch, Leaf],
          }),
        ],
      },
    });
    handles.push(handle);

    const [branchMock, leafMock] = handle.getMocks([Branch, Leaf] as const);
    const target = await handle.get(Target);

    expect(target.branch).toBe(branchMock);
    expect(target.leaf).toBe(leafMock);

    branchMock?.grow?.();
    const growSpy = required(handle.spyOf?.(Branch, "grow"), "grow spy");

    expect(growSpy).toHaveBeenCalledTimes(1);

    handle.clearMockSpies();
    expect(growSpy).not.toHaveBeenCalled();
  });

  it("restore reverts provider registry changes made by providers", () => {
    class RestoredService {}

    expect(dependenciesRegistry.has(RestoredService)).toBe(false);

    const handle = createTestContainer({
      providers: {
        services: [
          asClass(RestoredService, { lifecycle: lifecycle.transient() }),
        ],
      },
    });
    handles.push(handle);

    expect(dependenciesRegistry.has(RestoredService)).toBe(true);

    handle.restore();
    expect(dependenciesRegistry.has(RestoredService)).toBe(false);
  });
});

describe("vitest createTestContainer factory overrides", () => {
  const handles: Array<{ restore(): void }> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) {
      handle.restore();
    }
  });

  it("registers a factory override and resolves it through token injection", async () => {
    const ClientToken = createToken<{ endpoint: string }>("client");

    class Consumer {
      constructor(public client: { endpoint: string }) {}
    }

    const handle = createTestContainer({
      providers: {
        services: [
          asClass(Consumer, {
            lifecycle: lifecycle.transient(),
            deps: [ClientToken],
          }),
        ],
      },
      overrides: {
        factories: [
          [ClientToken, () => ({ endpoint: "https://test.example.com" })],
        ],
      },
    });
    handles.push(handle);

    const resolved = await handle.get(Consumer);

    expect(resolved.client.endpoint).toBe("https://test.example.com");
    expect(() => handle.getToken(ClientToken)).toThrow(
      /registered as a factory provider/,
    );
  });

  it("factory overrides replace provider factories for the same token", async () => {
    const ValueToken = createToken<string>("factory-override");

    class Consumer {
      constructor(public value: string) {}
    }

    const handle = createTestContainer({
      providers: {
        factories: [
          asFactory(ValueToken, () => "from-provider", {
            lifecycle: lifecycle.singleton(),
          }),
        ],
        services: [
          asClass(Consumer, {
            lifecycle: lifecycle.transient(),
            deps: [ValueToken],
          }),
        ],
      },
      overrides: {
        factories: [[ValueToken, () => "from-override"]],
      },
    });
    handles.push(handle);

    await expect(handle.get(Consumer)).resolves.toMatchObject({
      value: "from-override",
    });
  });

  it("respects factory override lifecycles", async () => {
    const SingletonToken = createToken<{ id: number }>("singleton-factory");
    const TransientToken = createToken<{ id: number }>("transient-factory");
    let singletonCalls = 0;
    let transientCalls = 0;

    class NeedsSingleton {
      constructor(public value: { id: number }) {}
    }
    class NeedsTransient {
      constructor(public value: { id: number }) {}
    }

    const handle = createTestContainer({
      providers: {
        services: [
          asClass(NeedsSingleton, {
            lifecycle: lifecycle.transient(),
            deps: [SingletonToken],
          }),
          asClass(NeedsTransient, {
            lifecycle: lifecycle.transient(),
            deps: [TransientToken],
          }),
        ],
      },
      overrides: {
        factories: [
          [
            SingletonToken,
            () => ({ id: ++singletonCalls }),
            { lifecycle: lifecycle.singleton() },
          ],
          [
            TransientToken,
            () => ({ id: ++transientCalls }),
            { lifecycle: lifecycle.transient() },
          ],
        ],
      },
    });
    handles.push(handle);

    await handle.get(NeedsSingleton);
    await handle.get(NeedsSingleton);
    await handle.get(NeedsTransient);
    await handle.get(NeedsTransient);

    expect(singletonCalls).toBe(1);
    expect(transientCalls).toBe(2);
  });

  it("provides and overrides factories after handle construction", async () => {
    const ValueToken = createToken<string>("post-construction-factory");

    class Consumer {
      constructor(public value: string) {}
    }

    const handle = createTestContainer({
      providers: {
        services: [
          asClass(Consumer, {
            lifecycle: lifecycle.transient(),
            deps: [ValueToken],
          }),
        ],
      },
    });
    handles.push(handle);

    handle.provideFactory(ValueToken, () => "first");
    await expect(handle.get(Consumer)).resolves.toMatchObject({
      value: "first",
    });

    handle.overrideFactory(ValueToken, () => "second");
    await expect(handle.get(Consumer)).resolves.toMatchObject({
      value: "second",
    });
  });

  it("keeps factory overrides explicit when autoMock is enabled", async () => {
    const ValueToken = createToken<string>("automock-factory");

    class Dependency {
      run() {
        return "real";
      }
    }
    class Target {
      constructor(
        public value: string,
        public dependency: Dependency,
      ) {}
    }

    const handle = createTestContainer({
      autoMock: true,
      target: Target,
      providers: {
        services: [
          asClass(Dependency, { lifecycle: lifecycle.transient() }),
          asClass(Target, {
            lifecycle: lifecycle.transient(),
            deps: [ValueToken, Dependency],
          }),
        ],
      },
      overrides: {
        factories: [[ValueToken, () => "factory-value"]],
      },
    });
    handles.push(handle);

    const resolved = await handle.get(Target);

    expect(resolved.value).toBe("factory-value");
    expect(handle.getMock(Dependency)).toBeDefined();
    expect(resolved.dependency).toBe(handle.getMock(Dependency));
  });

  it("creates configured scopes for custom-scoped factory overrides", async () => {
    const CurrentUserToken = createToken<string>("current-user");
    const GreetingToken = createToken<{ id: number; message: string }>(
      "greeting",
    );
    let calls = 0;

    class Consumer {
      constructor(public greeting: { id: number; message: string }) {}
    }

    const handle = createTestContainer({
      scopes: {
        session: {},
        request: { parent: s("session") },
      },
      providers: {
        services: [
          asClass(Consumer, {
            lifecycle: lifecycle.transient(),
            deps: [GreetingToken],
          }),
        ],
      },
      overrides: {
        factories: [
          [
            GreetingToken,
            (ctx) => ({
              id: ++calls,
              message: `hello ${ctx.getToken(CurrentUserToken)}`,
            }),
            { lifecycle: s("request") },
          ],
        ],
      },
    });
    handles.push(handle);

    const session = handle.createScope(s("session"));
    const request1 = session.createScope(s("request"));
    request1.provideValue(CurrentUserToken, "alice");

    const first = await request1.get(Consumer);
    const second = await request1.get(Consumer);
    expect(first).not.toBe(second);
    expect(first.greeting).toBe(second.greeting);
    expect(first.greeting).toMatchObject({
      id: 1,
      message: "hello alice",
    });

    const request2 = session.createScope(s("request"));
    request2.provideValue(CurrentUserToken, "bob");

    const third = await request2.get(Consumer);
    expect(third.greeting).toMatchObject({
      id: 2,
      message: "hello bob",
    });
  });
});

describe("vitest setupAlloyTesting auto-cleanup", () => {
  const alloyTesting = setupAlloyTesting();
  class Tracked {}

  it("registers providers within a test", () => {
    expect(dependenciesRegistry.has(Tracked)).toBe(false);

    alloyTesting.createTestContainer({
      providers: {
        services: [asClass(Tracked, { lifecycle: lifecycle.transient() })],
      },
    });

    // No manual restore: the afterEach registered by setupAlloyTesting() cleans up.
    expect(dependenciesRegistry.has(Tracked)).toBe(true);
  });

  it("auto-restored the previous test's registry mutations", () => {
    expect(dependenciesRegistry.has(Tracked)).toBe(false);
  });
});

describe("vitest setupAlloyTesting unwinds multiple containers in one test", () => {
  const alloyTesting = setupAlloyTesting();
  class First {}
  class Second {}

  it("registers providers across two containers in a single test", () => {
    expect(dependenciesRegistry.has(First)).toBe(false);
    expect(dependenciesRegistry.has(Second)).toBe(false);

    // The second container snapshots the registry *after* the first has already
    // registered First; LIFO cleanup must still return to the clean baseline.
    alloyTesting.createTestContainer({
      providers: {
        services: [asClass(First, { lifecycle: lifecycle.transient() })],
      },
    });
    alloyTesting.createTestContainer({
      providers: {
        services: [asClass(Second, { lifecycle: lifecycle.transient() })],
      },
    });

    expect(dependenciesRegistry.has(First)).toBe(true);
    expect(dependenciesRegistry.has(Second)).toBe(true);
  });

  it("auto-restored every container's registry mutations", () => {
    expect(dependenciesRegistry.has(First)).toBe(false);
    expect(dependenciesRegistry.has(Second)).toBe(false);
  });
});

describe("vitest direct createTestContainer has no auto-cleanup", () => {
  class Leaked {}

  afterAll(() => {
    dependenciesRegistry.delete(Leaked);
  });

  it("registers providers within a test", () => {
    expect(dependenciesRegistry.has(Leaked)).toBe(false);

    createTestContainer({
      providers: {
        services: [asClass(Leaked, { lifecycle: lifecycle.transient() })],
      },
    });

    expect(dependenciesRegistry.has(Leaked)).toBe(true);
  });

  it("did not auto-restore the previous test (registration persists)", () => {
    expect(dependenciesRegistry.has(Leaked)).toBe(true);
  });
});

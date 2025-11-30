import { deps, Injectable } from "./decorators";
import { describe, expect, it } from "vitest";
import { Container } from "./container";
import { Lazy } from "./lazy";

@Injectable()
class ToLoad {
  value = 7;
}

// Simple sanity: Lazy without failures
@Injectable(
  deps(Lazy(() => Promise.resolve({ default: ToLoad }), { retries: 2 })),
)
class UsesLazyOK {
  constructor(public s: ToLoad) {}
}

describe("Lazy retry", () => {
  it("succeeds when importer eventually resolves within retries", async () => {
    const container = new Container();

    let attempts = 0;
    @Injectable(
      deps(
        Lazy(
          async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error("temp network");
            }
            return { default: ToLoad };
          },
          { retries: 2, backoffMs: 1 },
        ),
      ),
    )
    class UsesEventually {
      constructor(public s: ToLoad) {}
    }

    const inst = await container.get(UsesEventually);
    expect(inst.s.value).toBe(7);
  });

  it("fails when retries are exhausted", async () => {
    const container = new Container();

    @Injectable(
      deps(
        Lazy(
          async () => {
            throw new Error("always down");
          },
          { retries: 1, backoffMs: 1 },
        ),
      ),
    )
    class UsesFail {
      constructor(public s: ToLoad) {}
    }

    await expect(container.get(UsesFail)).rejects.toThrow(
      /Failed to import lazy dependency/,
    );
  });

  it("works with Lazy when no failures occur", async () => {
    const container = new Container();
    const ok = await container.get(UsesLazyOK);
    expect(ok.s.value).toBe(7);
  });
});

@Injectable(
  deps(
    Lazy(async () => {
      throw new Error("kaboom");
    }),
  ),
)
class BDependsOnFailingLazy {}

@Injectable(deps(BDependsOnFailingLazy))
class ADependsOnB {}

describe("lazy import error includes formatted stack path", () => {
  it("reports 'A -> B' in the resolution stack when B's lazy dep fails", async () => {
    const c = new Container();
    await expect(c.get(ADependsOnB)).rejects.toThrow(
      /Failed to import lazy dependency/,
    );
    await expect(c.get(ADependsOnB)).rejects.toThrow(
      /ADependsOnB -> BDependsOnFailingLazy/,
    );
  });
});

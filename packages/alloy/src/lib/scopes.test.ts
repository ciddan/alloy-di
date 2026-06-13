import { beforeEach, describe, expect, it } from "vitest";
import { Container } from "./container";
import { deps, Injectable } from "./decorators";
import { createScope, Scope } from "../scopes";
import { createToken } from "./types";

// oxlint-disable-next-line no-explicit-any -- Justified: bypasses global scope augmentation in library tests.
const s = (name: string): any => name;

// --- Test Services ---

@Injectable(s("session"))
class SessionService {
  public id = Math.random();
}

@Injectable(s("request"))
class RequestService {
  public id = Math.random();
}

@Injectable(deps(SessionService), s("request"))
class RequestServiceWithDep {
  constructor(public session: SessionService) {}
}

@Injectable(deps(RequestService))
class TransientWithRequestDep {
  constructor(public request: RequestService) {}
}

// --- Disposal Lifecycle Test Classes ---

const disposalLogs: string[] = [];

class DisposableService {
  constructor(public name: string) {}

  public [Symbol.dispose](): void {
    disposalLogs.push(`${this.name}:dispose`);
  }
}

class AsyncDisposableService {
  constructor(public name: string) {}

  public async [Symbol.asyncDispose](): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    disposalLogs.push(`${this.name}:asyncDispose`);
  }
}

class CustomDestroyService {
  constructor(public name: string) {}

  public alloyOnDestroy(): void {
    disposalLogs.push(`${this.name}:alloyOnDestroy`);
  }
}

class AsyncCustomDestroyService {
  constructor(public name: string) {}

  public async alloyOnDestroy(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    disposalLogs.push(`${this.name}:alloyOnDestroyAsync`);
  }
}

class ThrowingDisposerService {
  constructor(public name: string) {}

  public [Symbol.dispose](): void {
    disposalLogs.push(`${this.name}:dispose`);
    throw new Error(`${this.name} failed during disposal`);
  }
}

describe("Hierarchical Scopes Runtime", () => {
  let container: Container;

  beforeEach(() => {
    disposalLogs.length = 0;
    container = new Container();
    container._registerScopeHierarchy({
      session: "singleton",
      request: "session",
    });
  });

  describe("Scope Creation & Validation", () => {
    it("allows creating a valid scope hierarchy", () => {
      const session = createScope(container, s("session"));
      expect(session).toBeInstanceOf(Scope);
      expect(session.scopeName).toBe("session");

      const request = createScope(session, s("request"));
      expect(request).toBeInstanceOf(Scope);
      expect(request.scopeName).toBe("request");
    });

    it("throws an error on parent scope mismatch (drift protection)", () => {
      expect(() => createScope(container, s("request"))).toThrow(
        /Invalid scope hierarchy construction: scope 'request' is declared with parent 'session', but was constructed with parent scope 'singleton'/,
      );
    });

    it("allows any parent if no hierarchy is registered (fallback/opt-in)", () => {
      const genericContainer = new Container();
      const customScope = createScope(genericContainer, s("session"));
      expect(customScope).toBeInstanceOf(Scope);
    });
  });

  describe("Resolution & Caching", () => {
    it("caches services within their designated scopes", async () => {
      const session1 = createScope(container, s("session"));
      const session2 = createScope(container, s("session"));

      const s1 = await session1.get(SessionService);
      const s1_again = await session1.get(SessionService);
      const s2 = await session2.get(SessionService);

      expect(s1).toBeInstanceOf(SessionService);
      expect(s1).toBe(s1_again);
      expect(s1).not.toBe(s2);
    });

    it("bubbles resolution to the matching scope in the parent chain", async () => {
      const session = createScope(container, s("session"));
      const request = createScope(session, s("request"));

      const sessionSvc = await session.get(SessionService);
      const resolvedFromRequest = await request.get(SessionService);

      expect(resolvedFromRequest).toBe(sessionSvc);
    });

    it("bubbles singleton resolution up to the root container", async () => {
      @Injectable("singleton")
      class RootSingleton {}

      const session = createScope(container, s("session"));
      const request = createScope(session, s("request"));

      const rootInstance = await container.get(RootSingleton);
      const requestInstance = await request.get(RootSingleton);

      expect(requestInstance).toBe(rootInstance);
    });

    it("resolves transient dependencies within the active scope context", async () => {
      const session = createScope(container, s("session"));
      const request = createScope(session, s("request"));

      const svc = await request.get(RequestServiceWithDep);
      expect(svc).toBeInstanceOf(RequestServiceWithDep);
      expect(svc.session).toBeInstanceOf(SessionService);

      const sessionSvc = await session.get(SessionService);
      expect(svc.session).toBe(sessionSvc);
    });

    it("resolves transient dependencies on the starting context", async () => {
      const session = createScope(container, s("session"));
      const request = createScope(session, s("request"));

      const svc1 = await request.get(TransientWithRequestDep);
      const svc2 = await request.get(TransientWithRequestDep);

      expect(svc1).not.toBe(svc2);
      expect(svc1.request).toBe(svc2.request);
    });
  });

  describe("Value Providers", () => {
    const TokenA = createToken<string>("TokenA");
    const TokenB = createToken<string>("TokenB");

    it("resolves locally provided values", () => {
      const session = createScope(container, s("session"));
      session.provideValue(TokenA, "session-val");

      expect(session.getToken(TokenA)).toBe("session-val");
    });

    it("bubbles value provider lookup to parent scopes and container", () => {
      container.provideValue(TokenA, "root-val");

      const session = createScope(container, s("session"));
      session.provideValue(TokenB, "session-val");

      const request = createScope(session, s("request"));

      expect(request.getToken(TokenA)).toBe("root-val");
      expect(request.getToken(TokenB)).toBe("session-val");
    });

    it("throws when token is not provided in the hierarchy", () => {
      const session = createScope(container, s("session"));
      expect(() => session.getToken(TokenA)).toThrow(
        /No provider registered for token/,
      );
    });
  });

  describe("Disposal Lifecycle", () => {
    it("disposes child scopes first, then parent scope services", async () => {
      const session = createScope(container, s("session"));
      const request = createScope(session, s("request"));

      @Injectable(s("request"))
      class ReqDisposable extends DisposableService {
        constructor() {
          super("Req");
        }
      }

      @Injectable(s("session"))
      class SessDisposable extends DisposableService {
        constructor() {
          super("Sess");
        }
      }

      await request.get(ReqDisposable);
      await request.get(SessDisposable);

      await session.dispose();

      expect(disposalLogs).toEqual(["Req:dispose", "Sess:dispose"]);
    });

    it("disposes services in reverse instantiation order (dependents first)", async () => {
      const session = createScope(container, s("session"));

      @Injectable(s("session"))
      class First extends DisposableService {
        constructor() {
          super("First");
        }
      }

      @Injectable(deps(First), s("session"))
      class Second extends DisposableService {
        constructor(public first: First) {
          super("Second");
        }
      }

      await session.get(Second);

      await session.dispose();

      expect(disposalLogs).toEqual(["Second:dispose", "First:dispose"]);
    });

    it("supports async, sync, and custom alloyOnDestroy disposal hooks", async () => {
      const session = createScope(container, s("session"));

      @Injectable(s("session"))
      class SvcA extends AsyncDisposableService {
        constructor() {
          super("SvcA");
        }
      }

      @Injectable(s("session"))
      class SvcB extends DisposableService {
        constructor() {
          super("SvcB");
        }
      }

      @Injectable(s("session"))
      class SvcC extends CustomDestroyService {
        constructor() {
          super("SvcC");
        }
      }

      @Injectable(s("session"))
      class SvcD extends AsyncCustomDestroyService {
        constructor() {
          super("SvcD");
        }
      }

      await session.get(SvcA);
      await session.get(SvcB);
      await session.get(SvcC);
      await session.get(SvcD);

      await session.dispose();

      expect(disposalLogs).toEqual([
        "SvcD:alloyOnDestroyAsync",
        "SvcC:alloyOnDestroy",
        "SvcB:dispose",
        "SvcA:asyncDispose",
      ]);
    });

    it("clears cached instances and removes self from parent active children upon disposal", async () => {
      const session = createScope(container, s("session"));
      const request = createScope(session, s("request"));

      @Injectable(s("request"))
      class Req extends DisposableService {
        constructor() {
          super("Req");
        }
      }

      const reqInstance1 = await request.get(Req);
      await request.dispose();

      const newRequest = createScope(session, s("request"));
      const reqInstance2 = await newRequest.get(Req);

      expect(reqInstance1).not.toBe(reqInstance2);
    });

    it("supports native [Symbol.asyncDispose] protocol", async () => {
      @Injectable(s("session"))
      class SessDisposable extends DisposableService {
        constructor() {
          super("Sess");
        }
      }

      {
        await using session = createScope(container, s("session"));
        await session.get(SessDisposable);
      }

      expect(disposalLogs).toEqual(["Sess:dispose"]);
    });

    it("continues disposal of remaining services and cleans up local caches if one throws", async () => {
      const session = createScope(container, s("session"));

      @Injectable(s("session"))
      class EarlyService extends DisposableService {
        constructor() {
          super("Early");
        }
      }

      @Injectable(s("session"))
      class ThrowingService extends ThrowingDisposerService {
        constructor() {
          super("Thrower");
        }
      }

      @Injectable(s("session"))
      class LateService extends DisposableService {
        constructor() {
          super("Late");
        }
      }

      await session.get(EarlyService);
      await session.get(ThrowingService);
      await session.get(LateService);

      await expect(session.dispose()).rejects.toThrow(
        /Thrower failed during disposal/,
      );

      expect(disposalLogs).toEqual([
        "Late:dispose",
        "Thrower:dispose",
        "Early:dispose",
      ]);
    });

    it("aggregates multiple errors if multiple disposers throw", async () => {
      const session = createScope(container, s("session"));

      @Injectable(s("session"))
      class Thrower1 extends ThrowingDisposerService {
        constructor() {
          super("T1");
        }
      }

      @Injectable(s("session"))
      class Thrower2 extends ThrowingDisposerService {
        constructor() {
          super("T2");
        }
      }

      await session.get(Thrower1);
      await session.get(Thrower2);

      await expect(session.dispose()).rejects.toThrow(AggregateError);
      expect(disposalLogs).toEqual(["T2:dispose", "T1:dispose"]);
    });
  });
});

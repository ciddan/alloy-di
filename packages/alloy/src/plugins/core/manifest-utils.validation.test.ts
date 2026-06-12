import { afterEach, describe, it, expect, vi } from "vitest";
import { readManifests } from "./manifest-utils";

describe("manifest validation (ESM + Zod)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a well-formed manifest and aggregates entries", async () => {
    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      services: [
        {
          importPath: "@scope/lib/src/analytics-service",
          exportName: "AnalyticsService",
          symbolKey:
            "alloy:@scope/lib/src/analytics-service.ts#AnalyticsService",
          scope: "singleton",
          deps: ["HeavyProcessor"],
          tokenDeps: [
            {
              exportName: "ApiBaseUrl",
              importPath: "@scope/lib/src/tokens",
            },
          ],
          lazyDeps: [
            {
              importPath: "@scope/lib/src/heavy-processor",
              exportName: "HeavyProcessor",
              retry: { retries: 1 },
            },
          ],
        },
      ],
      providers: ["@scope/lib/src/providers"],
    };

    // @ts-expect-error testing manifest object input
    const { services, providers } = await readManifests([manifest]);
    expect(services.length).toBe(1);
    expect(services[0].exportName).toBe("AnalyticsService");
    expect(providers).toEqual(["@scope/lib/src/providers"]);
  });

  it("accepts a well-formed v2 manifest with ordered dependencies", async () => {
    const manifest = {
      schemaVersion: 2,
      packageName: "@scope/lib",
      services: [
        {
          importPath: "@scope/lib/src/consumer",
          exportName: "Consumer",
          symbolKey: "alloy:@scope/lib/src/consumer.ts#Consumer",
          scope: "singleton",
          deps: [
            { kind: "class", exportName: "AnalyticsService" },
            {
              kind: "lazy",
              importPath: "@scope/lib/src/heavy-processor",
              exportName: "HeavyProcessor",
              retry: { retries: 1 },
            },
            {
              kind: "token",
              importPath: "@scope/lib/src/tokens",
              exportName: "ApiBaseUrl",
            },
          ],
        },
      ],
      providers: ["@scope/lib/src/providers"],
    };

    // @ts-expect-error testing manifest object input
    const { services, providers } = await readManifests([manifest]);
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      exportName: "Consumer",
      schemaVersion: 2,
    });
    expect(providers).toEqual(["@scope/lib/src/providers"]);
  });

  it("skips invalid manifests (wrong types/missing required fields) with a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Missing scope and wrong tokenDeps shape
    const manifest = {
      services: [
        {
          importPath: "@scope/lib/src/foo",
          exportName: "FooService",
          // scope missing
          tokenDeps: [{ bad: true }],
        },
      ],
    };

    // @ts-expect-error testing invalid input
    const { services, providers } = await readManifests([manifest]);
    expect(services.length).toBe(0);
    expect(providers.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain(
      '[alloy] Ignoring invalid manifest "<unknown package>"',
    );
  });

  it("names the package and the offending fields when a v2 manifest is invalid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manifest = {
      schemaVersion: 2,
      packageName: "@scope/broken-lib",
      services: [
        {
          importPath: "@scope/broken-lib/src/consumer",
          exportName: "Consumer",
          symbolKey: "alloy:@scope/broken-lib/src/consumer.ts#Consumer",
          scope: "request", // not a valid scope
          deps: [{ kind: "class", exportName: "AnalyticsService" }],
        },
      ],
    };

    // @ts-expect-error testing invalid input
    const { services, loadedManifests } = await readManifests([manifest]);
    expect(services).toHaveLength(0);
    expect(loadedManifests).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('Ignoring invalid manifest "@scope/broken-lib"');
    expect(message).toContain("scope");
  });

  it("does not warn for valid manifests", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manifest = {
      schemaVersion: 1,
      packageName: "@scope/lib",
      services: [],
      providers: [],
    };

    // @ts-expect-error testing manifest object input
    const { loadedManifests } = await readManifests([manifest]);
    expect(loadedManifests).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

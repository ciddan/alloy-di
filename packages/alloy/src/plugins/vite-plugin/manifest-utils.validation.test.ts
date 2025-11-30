import { describe, it, expect } from "vitest";
import { readManifests } from "./manifest-utils";

describe("manifest validation (ESM + Zod)", () => {
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

  it("skips invalid manifests (wrong types/missing required fields)", async () => {
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
  });
});

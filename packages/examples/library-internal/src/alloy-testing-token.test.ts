import { describe, it, expect } from "vitest";
import { createTestContainer } from "alloy-di/test";
import { LibraryApiBaseUrl } from "./tokens";
import { AnalyticsService } from "./analytics-service";

// Phase 2: verify container.getToken wiring via test helpers

describe("getToken retrieves provided token values", () => {
  it("returns the overridden token value", async () => {
    const baseUrl = "https://test.local/api";
    const test = createTestContainer({
      overrides: {
        tokens: [[LibraryApiBaseUrl, baseUrl]],
      },
    });

    // Direct token access
    const retrieved = test.getToken(LibraryApiBaseUrl);
    expect(retrieved).toBe(baseUrl);

    // Also ensure services receiving the token get the override
    const analytics = await test.get(AnalyticsService);
    // Call a method to ensure instance constructed; we cannot directly read constructor param,
    // but lack of throw means token value was present in resolution.
    analytics.track("token_check", { value: retrieved });
    expect(analytics.getEventCount()).toBeGreaterThan(0);

    test.restore();
  });

  it("throws when token is not provided", () => {
    const test = createTestContainer();
    expect(() => test.getToken(LibraryApiBaseUrl)).toThrow(
      /No provider registered/,
    );

    test.restore();
  });

  it("can provide a token after creation", async () => {
    const test = createTestContainer();
    test.provideToken?.(LibraryApiBaseUrl, "https://late.provide/api");
    expect(test.getToken(LibraryApiBaseUrl)).toBe("https://late.provide/api");

    const analytics = await test.get(AnalyticsService);
    analytics.track("late_token", { value: test.getToken(LibraryApiBaseUrl) });
    expect(analytics.getEventCount()).toBeGreaterThan(0);

    test.restore();
  });
});

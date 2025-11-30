import { describe, it, expect } from "vitest";
import { createTestContainer } from "alloy-di/test";
import { EventTracker } from "./event-tracker";
import { AnalyticsService } from "./analytics-service";

// Phase 2 auto-mock test: immediate class dependencies of target should be mocked.

describe("autoMock immediate dependencies", () => {
  it("mocks direct class dependency (AnalyticsService) while leaving lazy HeavyProcessor real", async () => {
    const test = createTestContainer({
      target: EventTracker,
      autoMock: true,
    });

    const tracker = await test.get(EventTracker);
    tracker.trackPageView("/home");
    tracker.trackButtonClick("cta", "hero");

    const analyticsMock = test.getMock(AnalyticsService);
    expect(analyticsMock).toBeTruthy();
    expect(analyticsMock?.spies.track).toHaveBeenCalledTimes(2);

    // Using spyOf convenience accessor
    const trackSpy = test.spyOf?.(AnalyticsService, "track");
    expect(trackSpy?.mock.calls.length).toBe(2);

    // Clear spies and assert they are reset
    test.clearMockSpies?.();
    expect(trackSpy?.mock.calls.length).toBe(0);

    // Ensure original methods of heavy processor executed (console output side-effect not asserted)
    // HeavyProcessor not auto-mocked in Phase 2 (lazy dependency)
    test.restore();
  });
});

import { describe, it, expect } from "vitest";
import { createTestContainer } from "alloy-di/test";
import providers from "./providers";
import { AnalyticsService } from "./analytics-service";
import { EventTracker } from "./event-tracker";
import { HeavyProcessor } from "./heavy-processor";

// This test ensures deep automocking traverses multiple levels and mocks lazy deps.
// Graph: EventTracker -> AnalyticsService -> HeavyProcessor (Lazy)
// We autoMock target EventTracker and expect heavy processor methods to be spies.

describe("deep + lazy autoMock", () => {
  it("mocks deep deps including lazy-loaded services", async () => {
    const test = createTestContainer({
      providers,
      autoMock: true,
      target: EventTracker,
    });

    // Access EventTracker and run track events; under the hood, HeavyProcessor (lazy) should be mocked.
    const tracker = await test.get(EventTracker);
    tracker.trackButtonClick("deep_lazy", "header");

    // Retrieve mocks and assert spy call counts
    const heavyMock = test.getMock(HeavyProcessor);
    expect(heavyMock?.spies.process).toHaveBeenCalledTimes(1);

    const analyticsMock = test.getMock(AnalyticsService);
    expect(analyticsMock?.spies.track).toHaveBeenCalledTimes(1);

    // Demonstrate spyOf and clearMockSpies
    const trackSpy = test.spyOf?.(AnalyticsService, "track");
    expect(trackSpy?.mock.calls.length).toBe(1);
    test.clearMockSpies?.();
    expect(trackSpy?.mock.calls.length).toBe(0);

    test.restore();
  });
});

import { describe, it, expect } from "vitest";
import { createTestContainer } from "alloy-di/test";
import { AnalyticsService } from "./analytics-service";
import { EventTracker } from "./event-tracker";
import { LibraryApiBaseUrl } from "./tokens";

class AnalyticsServiceStub {
  public events: Array<{ name: string; data?: unknown }> = [];
  track(name: string, data?: unknown) {
    this.events.push({ name, data });
  }
  getEvents() {
    return [...this.events];
  }
  getEventCount() {
    return this.events.length;
  }
}

describe("createTestContainer manual overrides (Phase 1)", () => {
  it("overrides token and service instance", async () => {
    const stub = new AnalyticsServiceStub();

    const test = createTestContainer({
      tokens: [[LibraryApiBaseUrl, "https://test.local/api"]],
      instances: [[AnalyticsService, stub]],
    });
    // Resolve dependent service
    const tracker = await test.get(EventTracker);

    tracker.trackPageView("/home");
    tracker.trackButtonClick("cta", "hero");

    expect(stub.getEventCount()).toBe(2);
    expect(stub.getEvents()[0].name).toBe("page_view");

    // Ensure container returns our stub when asking directly
    const resolvedAnalytics = await test.get(AnalyticsService);
    expect(resolvedAnalytics).toBe(stub);

    test.restore();
  });
});

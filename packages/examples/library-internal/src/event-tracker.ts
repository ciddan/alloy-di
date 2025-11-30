import { Injectable, Lazy, deps } from "alloy-di/runtime";
import type { AnalyticsService } from "./analytics-service";
import type { HeavyProcessor } from "./heavy-processor";

/**
 * EventTracker - A transient service that provides convenient methods for tracking
 * specific types of events. Depends on AnalyticsService.
 *
 * This demonstrates dependency injection between services within an internal library.
 */
@Injectable(
  deps(
    Lazy(() => import("./analytics-service").then((m) => m.AnalyticsService)),
    Lazy(() => import("./heavy-processor").then((m) => m.HeavyProcessor), {
      retries: 1,
      backoffMs: 100,
    }),
  ),
)
export class EventTracker {
  constructor(
    private analytics: AnalyticsService,
    private processor: HeavyProcessor,
  ) {}

  trackPageView(page: string): void {
    this.analytics.track("page_view", { page });
    this.processor.process("page_view", { page });
  }

  trackButtonClick(buttonName: string, location: string): void {
    this.analytics.track("button_click", { buttonName, location });
    this.processor.process("button_click", { buttonName, location });
  }

  trackError(error: Error, context?: string): void {
    this.analytics.track("error", {
      message: error.message,
      stack: error.stack,
      context,
    });
    this.processor.process("error", { message: error.message, context });
  }
}

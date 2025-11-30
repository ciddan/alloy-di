import { Injectable, Lazy, deps } from "alloy-di/runtime";
import type { AnalyticsService } from "./analytics-service";

/**
 * ReportingService - Demonstrates a Lazy dependency on AnalyticsService.
 * This service is intentionally separated from eager consumers so that lazy loading
 * can be exercised without impacting critical session lifecycle paths.
 */
@Injectable(
  deps(
    Lazy(() => import("./analytics-service").then((m) => m.AnalyticsService)),
  ),
)
export class ReportingService {
  constructor(private analytics: AnalyticsService) {}

  generateDailyReport(): void {
    this.analytics.track("daily_report_generated", { date: new Date() });
  }

  generateCustomReport(name: string, data?: unknown): void {
    this.analytics.track("custom_report_generated", { name, data });
  }
}

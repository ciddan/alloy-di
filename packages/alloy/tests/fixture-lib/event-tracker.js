import { AnalyticsService } from "./analytics-service.js";
export class EventTracker {
  constructor() {
    this.analytics = new AnalyticsService();
  }
  trackPageView(page) {
    this.analytics.track("page_view", { page });
  }
}

import { AnalyticsService } from "./analytics-service.js";
export class UserSession {
  constructor() {
    this.analytics = new AnalyticsService();
  }
  start(id) {
    this.userId = id;
    this.analytics.track("session_start", { id });
  }
}

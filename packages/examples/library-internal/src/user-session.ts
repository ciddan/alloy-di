import { Singleton, Lazy, deps } from "alloy-di/runtime";
import type { AnalyticsService } from "./analytics-service";

/**
 * UserSession - A singleton that manages user session state.
 * Demonstrates another singleton service with a dependency.
 */
@Singleton(
  deps(
    Lazy(() => import("./analytics-service").then((m) => m.AnalyticsService)),
  ),
)
export class UserSession {
  private userId: string | null = null;
  private sessionStartTime: Date | null = null;

  constructor(private analytics: AnalyticsService) {}

  startSession(userId: string): void {
    this.userId = userId;
    this.sessionStartTime = new Date();
    this.analytics.track("session_start", { userId });
  }

  endSession(): void {
    if (this.userId && this.sessionStartTime) {
      const duration = Date.now() - this.sessionStartTime.getTime();
      this.analytics.track("session_end", {
        userId: this.userId,
        durationMs: duration,
      });
    }
    this.userId = null;
    this.sessionStartTime = null;
  }

  getCurrentUserId(): string | null {
    return this.userId;
  }

  isActive(): boolean {
    return this.userId !== null;
  }
}

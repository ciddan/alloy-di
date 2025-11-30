import { Injectable, deps } from "alloy-di/runtime";
import { EventTracker } from "@alloy-di/example-library-internal/event-tracker";
import { UserSession } from "@alloy-di/example-library-internal/user-session";

/**
 * AnalyticsConsumer - Demonstrates consuming services from an internal monorepo library.
 * The EventTracker and UserSession services are automatically discovered by Alloy's plugin
 * because they use decorators directly in the library code.
 */
@Injectable(deps(EventTracker, UserSession))
export class AnalyticsConsumer {
  constructor(
    private eventTracker: EventTracker,
    private userSession: UserSession,
  ) {}

  initialize(userId: string): void {
    this.userSession.startSession(userId);
    this.eventTracker.trackPageView("home");
  }

  trackAction(action: string, details?: string): void {
    if (!this.userSession.isActive()) {
      console.warn("No active session, cannot track action");
      return;
    }

    this.eventTracker.trackButtonClick(action, details || "unknown");
  }

  getSessionInfo(): string {
    const userId = this.userSession.getCurrentUserId();
    const active = this.userSession.isActive();
    return `Session: ${userId || "none"} (${active ? "active" : "inactive"})`;
  }

  shutdown(): void {
    this.userSession.endSession();
  }
}

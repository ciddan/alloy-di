import { deps, Singleton } from "alloy-di/runtime";
import { LibraryApiBaseUrl } from "./tokens";

/**
 * AnalyticsService - A singleton service that tracks application analytics.
 * This demonstrates how internal monorepo libraries can use Alloy decorators directly.
 */
@Singleton(deps(LibraryApiBaseUrl))
export class AnalyticsService {
  private events: Array<{ name: string; timestamp: Date; data?: unknown }> = [];

  constructor(private baseUrl: string) {
    console.log(`[AnalyticsService] Initialized with baseUrl: ${this.baseUrl}`);
  }

  track(eventName: string, data?: unknown): void {
    this.events.push({
      name: eventName,
      timestamp: new Date(),
      data,
    });

    console.log(`[Analytics] Event tracked: ${eventName}`, data);
  }

  getEvents() {
    return [...this.events];
  }

  getEventCount(): number {
    return this.events.length;
  }
}

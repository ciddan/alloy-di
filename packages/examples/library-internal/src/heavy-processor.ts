import { Injectable } from "alloy-di/runtime";

/**
 * HeavyProcessor - A transient component intended to be loaded lazily.
 * This simulates an expensive helper used by other services.
 */
@Injectable()
export class HeavyProcessor {
  process(eventName: string, data?: unknown): void {
    // Simulate some heavier processing work.
    const size =
      typeof data === "object" && data !== null
        ? JSON.stringify(data).length
        : 0;
    // eslint-disable-next-line no-console
    console.log(
      `[HeavyProcessor] processed '${eventName}' (payloadSize=${size})`,
    );
  }
}

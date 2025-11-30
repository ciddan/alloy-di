import { Injectable, deps } from "alloy-di/runtime";
import type { Logger } from "@alloy-di/example-library-external";
import { LoggerService } from "../providers";

@Injectable(deps(LoggerService))
export class LazyService {
  constructor(private logger: Logger) {
    this.logger.info("LazyService initialized (loaded lazily)");
  }

  getName() {
    return "I am a lazy service 🥱";
  }
}

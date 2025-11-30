import { deps, Injectable, Lazy } from "alloy-di/runtime";
import type { Logger } from "@alloy-di/example-library-external";
import type { LazyService } from "./lazy-service";
import { LoggerService } from "../providers";

@Injectable(
  deps(
    Lazy(() => import("./lazy-service").then((m) => m.LazyService)),
    LoggerService,
  ),
)
export class ConsumerService {
  constructor(
    private lazyService: LazyService,
    private logger: Logger,
  ) {
    this.logger.info("ConsumerService initialized");
  }

  getLazyMessage() {
    return `Consumer says: ${this.lazyService.getName()}`;
  }
}

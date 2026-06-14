import { Singleton, deps } from "alloy-di/runtime";
import type { Logger } from "@alloy-di/example-library-external";
import { LoggerService } from "../providers";

@Singleton(deps(LoggerService))
export class ServiceA {
  public value = "Hello from singleton ServiceA";

  constructor(private logger: Logger) {
    this.logger.info("ServiceA initialized");
  }
}

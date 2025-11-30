import { deps, Injectable } from "alloy-di/runtime";
import type { Logger } from "@alloy-di/example-library-external";
import { ApiBaseUrl } from "./tokens";
import { ServiceA } from "./service-a";
import { LoggerService } from "../providers";

@Injectable(deps(ServiceA, ApiBaseUrl, LoggerService))
export class AppService {
  constructor(
    private serviceA: ServiceA,
    private baseUrl: string,
    private logger: Logger,
  ) {
    this.logger.info("AppService initialized", { baseUrl: this.baseUrl });
  }

  public getValue() {
    return `AppService gets: "${this.serviceA.value}" (baseUrl: ${this.baseUrl})`;
  }
}

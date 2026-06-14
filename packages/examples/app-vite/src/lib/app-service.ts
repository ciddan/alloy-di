import { deps, Injectable } from "alloy-di/runtime";
import type { Logger } from "@alloy-di/example-library-external";
import type { ApiClient } from "./api-client";
import { ApiClientToken } from "./tokens";
import { ServiceA } from "./service-a";
import { LoggerService } from "../providers";

@Injectable(deps(ServiceA, ApiClientToken, LoggerService))
export class AppService {
  constructor(
    private serviceA: ServiceA,
    private apiClient: ApiClient,
    private logger: Logger,
  ) {
    this.logger.info("AppService initialized", {
      baseUrl: this.apiClient.baseUrl,
    });
  }

  public getValue() {
    return `AppService gets: "${this.serviceA.value}" (api: ${this.apiClient.endpoint("/status")})`;
  }
}

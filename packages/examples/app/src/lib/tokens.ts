import { createToken } from "alloy-di/runtime";
import type { ApiClient, RequestApiClient } from "./api-client";

export const ApiBaseUrl = createToken<string>("api-base-url");
export const ApiClientToken = createToken<ApiClient>("api-client");
export const RequestApiClientToken =
  createToken<RequestApiClient>("request-api-client");

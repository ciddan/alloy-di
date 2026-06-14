import {
  asClass,
  asFactory,
  asLazyClass,
  asValue,
  defineProviders,
  deps,
  lifecycle,
} from "alloy-di/runtime";
import { ConsoleOutput } from "@alloy-di/example-library-external/console-output";
import { ApiClient, RequestApiClient } from "./lib/api-client";
import { SessionUser } from "./lib/session-user";
import {
  ApiBaseUrl,
  ApiClientToken,
  RequestApiClientToken,
} from "./lib/tokens";

export const LoggerService = asLazyClass(
  () =>
    import("@alloy-di/example-library-external/logger").then((m) => m.Logger),
  {
    lifecycle: lifecycle.singleton(),
    deps: deps(ConsoleOutput),
    label: "LoggerService",
  },
);

export default defineProviders({
  values: [asValue(ApiBaseUrl, "https://api.example.com")],
  factories: [
    asFactory(
      ApiClientToken,
      (ctx) => new ApiClient(ctx.getToken(ApiBaseUrl)),
      {
        lifecycle: lifecycle.singleton(),
      },
    ),
    asFactory(
      RequestApiClientToken,
      async (ctx) => {
        const sessionUser = await ctx.get(SessionUser);
        // Factory contexts resolve value tokens synchronously; factory tokens resolve through service deps.
        const apiClient = new ApiClient(ctx.getToken(ApiBaseUrl));

        return new RequestApiClient(apiClient, sessionUser.username);
      },
      { lifecycle: "request" },
    ),
  ],
  services: [
    asClass(ConsoleOutput, {
      lifecycle: lifecycle.singleton(),
    }),
  ],
  lazyServices: [LoggerService],
});

import {
  asClass,
  asLazyClass,
  asValue,
  defineProviders,
  deps,
  lifecycle,
} from "alloy-di/runtime";
import { ConsoleOutput } from "@alloy-di/example-library-external/console-output";
import { ApiBaseUrl } from "./lib/tokens";

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
  services: [
    asClass(ConsoleOutput, {
      lifecycle: lifecycle.singleton(),
    }),
  ],
  lazyServices: [LoggerService],
});

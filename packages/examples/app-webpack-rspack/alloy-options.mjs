import { ReportingServiceIdentifier } from "@alloy-di/example-library-internal/service-identifiers";
import { manifest } from "@alloy-di/example-library-internal/manifest";

export const alloyOptions = {
  containerDeclarationDir: "src",
  providers: ["../app-vite/src/providers.ts"],
  sourceDirs: ["../app-vite/src"],
  manifests: [manifest],
  lazyServices: [ReportingServiceIdentifier],
  scopes: {
    session: {},
    request: { parent: "session" },
  },
};

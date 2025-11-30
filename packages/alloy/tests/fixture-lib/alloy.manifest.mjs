// Fixture manifest (chunks mode)
export const manifest = {
  schemaVersion: 1,
  packageName: "@upn/fixture-lib",
  buildMode: "chunks",
  services: [
    {
      exportName: "AnalyticsService",
      importPath: "@upn/fixture-lib/analytics-service",
      symbolKey:
        "alloy:@upn/fixture-lib/src/analytics-service.ts#AnalyticsService",
      scope: "singleton",
      deps: [],
      lazyDeps: [],
      source: "src/analytics-service.ts",
    },
    {
      exportName: "EventTracker",
      importPath: "@upn/fixture-lib/event-tracker",
      symbolKey: "alloy:@upn/fixture-lib/src/event-tracker.ts#EventTracker",
      scope: "transient",
      deps: [],
      lazyDeps: [
        {
          exportName: "AnalyticsService",
          importPath: "@upn/fixture-lib/analytics-service",
        },
      ],
      source: "src/event-tracker.ts",
    },
    {
      exportName: "UserSession",
      importPath: "@upn/fixture-lib/user-session",
      symbolKey: "alloy:@upn/fixture-lib/src/user-session.ts#UserSession",
      scope: "singleton",
      deps: ["AnalyticsService"],
      lazyDeps: [],
      source: "src/user-session.ts",
    },
  ],
  diagnostics: { barrelFallback: true },
};

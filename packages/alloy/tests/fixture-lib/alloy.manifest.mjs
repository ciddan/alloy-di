// Fixture manifest (chunks mode)
export const manifest = {
  schemaVersion: 1,
  packageName: "@acme/fixture-lib",
  buildMode: "chunks",
  services: [
    {
      exportName: "AnalyticsService",
      importPath: "@acme/fixture-lib/analytics-service",
      symbolKey:
        "alloy:@acme/fixture-lib/src/analytics-service.ts#AnalyticsService",
      scope: "singleton",
      deps: [],
      lazyDeps: [],
      source: "src/analytics-service.ts",
    },
    {
      exportName: "EventTracker",
      importPath: "@acme/fixture-lib/event-tracker",
      symbolKey: "alloy:@acme/fixture-lib/src/event-tracker.ts#EventTracker",
      scope: "transient",
      deps: [],
      lazyDeps: [
        {
          exportName: "AnalyticsService",
          importPath: "@acme/fixture-lib/analytics-service",
        },
      ],
      source: "src/event-tracker.ts",
    },
    {
      exportName: "UserSession",
      importPath: "@acme/fixture-lib/user-session",
      symbolKey: "alloy:@acme/fixture-lib/src/user-session.ts#UserSession",
      scope: "singleton",
      deps: ["AnalyticsService"],
      lazyDeps: [],
      source: "src/user-session.ts",
    },
  ],
  diagnostics: { barrelFallback: true },
};

import { Suspense, use, useEffect, useRef, useState } from "react";

import { createScope, type Scope } from "alloy-di/scopes";
import container, { serviceIdentifiers } from "virtual:alloy-container";
import { RequestLogger } from "./lib/request-logger";
import { SessionUser } from "./lib/session-user";
import styles from "./App.module.scss";

const {
  AppService: appServiceId,
  ConsumerService: consumerServiceId,
  AnalyticsConsumer: analyticsConsumerId,
  ReportingService: reportingServiceId,
} = serviceIdentifiers;

const appServicePromise = container.get(appServiceId);
const consumerServicePromise = container.get(consumerServiceId);
const analyticsConsumerPromise = container.get(analyticsConsumerId);
const reportingServicePromise = container.get(reportingServiceId);


function AppContent() {
  const [count, setCount] = useState<number>(0);
  const appService = use(appServicePromise);
  const consumerService = use(consumerServicePromise);
  const analyticsConsumer = use(analyticsConsumerPromise);
  const reportingService = use(reportingServicePromise);

  const sessionScopeRef = useRef<Scope | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{
    username: string;
    createdAt: string;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleCreateSession = async () => {
    if (sessionScopeRef.current) {
      addLog("Disposing existing session scope...");
      analyticsConsumer.shutdown();
      await sessionScopeRef.current.dispose();
      sessionScopeRef.current = null;
    }

    addLog("Creating new session scope...");
    const newScope = createScope(container, "session");
    sessionScopeRef.current = newScope;

    addLog("Resolving SessionUser service from session scope...");
    const user = await newScope.get(SessionUser);
    setSessionInfo({
      username: user.username,
      createdAt: user.createdAt,
    });

    // Initialize analytics for the active scoped session user
    analyticsConsumer.initialize(user.username);

    addLog(`Session active: user is ${user.username}`);
  };

  const handleDisposeSession = async () => {
    if (sessionScopeRef.current) {
      addLog("Disposing session scope...");
      analyticsConsumer.shutdown();
      await sessionScopeRef.current.dispose();
      sessionScopeRef.current = null;
      setSessionInfo(null);
      addLog("Session scope disposed.");
    }
  };

  const handleSimulatedRequest = async () => {
    if (!sessionScopeRef.current) {
      addLog("No active session scope. Create one first.");
      return;
    }

    addLog("Simulating incoming HTTP request...");
    addLog("Creating child request scope from session scope...");
    const requestScope = sessionScopeRef.current.createScope("request");

    try {
      addLog("Resolving RequestLogger from request scope...");
      const logger = await requestScope.get(RequestLogger);

      logger.log("Handling API request to /api/dashboard");
      addLog(`[Request Context] Logger ID: ${logger.requestId}`);
      addLog(
        `[Request Factory] API client: ${logger.describeApiRequest("/dashboard")}`,
      );
      const requestUser = await requestScope.get(SessionUser);
      addLog(
        `[Request Context] Injected SessionUser: ${requestUser.username}`,
      );

      logger.log("Request successfully processed.");
    } finally {
      addLog("Disposing request scope...");
      await requestScope.dispose();
      addLog("Request scope disposed.");
    }
  };

  useEffect(() => {
    return () => {
      analyticsConsumer.shutdown();
      if (sessionScopeRef.current) {
        void sessionScopeRef.current.dispose();
      }
    };
  }, [analyticsConsumer]);

  const handleClick = () => {
    setCount((c) => c + 1);
    analyticsConsumer.trackAction("increment_counter", "main_button");
  };

  const generateReport = () => {
    reportingService.generateDailyReport();
    addLog("Generated daily report through a factory-lazy service.");
  };

  const serviceSummaries = [
    {
      label: "App service",
      value: appService.getValue(),
      tone: "blue",
    },
    {
      label: "Lazy service",
      value: consumerService.getLazyMessage(),
      tone: "amber",
    },
    {
      label: "Analytics",
      value: analyticsConsumer.getSessionInfo(),
      tone: "teal",
    },
    {
      label: "Reporter",
      value: "ReportingService is factory-lazy and resolves on demand.",
      tone: "violet",
    },
  ] as const;

  return (
    <main className={styles.shell}>
      <div className={styles.heroBg} aria-hidden="true">
        <GraphIllustration />
      </div>

      <div className={styles.actionsBar}>
        <button className={styles.primaryButton} onClick={handleClick}>
          Count is {count}
        </button>
        <button className={styles.secondaryButton} onClick={generateReport}>
          Generate daily report
        </button>
      </div>

      <section className={styles.summaryGrid} aria-label="Resolved services">
        {serviceSummaries.map((item) => (
          <article
            className={`${styles.summaryCard} ${styles[item.tone]}`}
            key={item.label}
          >
            <span>{item.label}</span>
            <p>{item.value}</p>
          </article>
        ))}
      </section>

      <section className={styles.workspace}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={`${styles.pill} ${styles.pillSmall}`}>
              <span className={styles.pillDot}></span>
              Custom lifecycles
            </span>
            <h2>Hierarchical scopes</h2>
            <p>
              Session and request scopes demonstrate parent-child resolution,
              factory providers, and ordered disposal.
            </p>
          </div>

          <div className={styles.statusCard}>
            <span>Session status</span>
            <strong className={sessionInfo ? styles.active : styles.inactive}>
              {sessionInfo ? "Active" : "Inactive"}
            </strong>
            {sessionInfo && (
              <dl>
                <div>
                  <dt>User</dt>
                  <dd>{sessionInfo.username}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{sessionInfo.createdAt}</dd>
                </div>
              </dl>
            )}
          </div>

          <div className={styles.buttonRow}>
            <button
              className={styles.primaryButton}
              onClick={handleCreateSession}
            >
              {sessionInfo ? "Restart session" : "Create session"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleDisposeSession}
              disabled={!sessionInfo}
            >
              Dispose session
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleSimulatedRequest}
              disabled={!sessionInfo}
            >
              Simulate request
            </button>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={`${styles.pill} ${styles.pillSmall}`}>
              <span className={styles.pillDot}></span>
              Runtime log
            </span>
            <h2>Scope lifecycle events</h2>
          </div>
          <div className={styles.logsContainer}>
            {logs.length === 0 ? (
              <p>No events logged yet. Create a session to start.</p>
            ) : (
              logs.map((log, index) => (
                <div key={`${log}-${index}`} className={styles.logEntry}>
                  {log}
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

export function App() {
  return (
    <Suspense
      fallback={<div className={styles.loading}>Loading Alloy services...</div>}
    >
      <AppContent />
    </Suspense>
  );
}

function GraphIllustration() {
  const gnodes = [
    { x: 150, y: 92, r: 4 },
    { x: 150, y: 214, r: 4 },
    { x: 272, y: 56, r: 4 },
    { x: 272, y: 150, r: 6, key: true },
    { x: 272, y: 252, r: 4 },
    { x: 392, y: 104, r: 5, key: true },
    { x: 392, y: 206, r: 4 },
    { x: 392, y: 300, r: 4 },
    { x: 452, y: 58, r: 3 },
  ];
  const gedges: [number, number][] = [
    [0, 2],
    [0, 3],
    [1, 3],
    [1, 4],
    [2, 5],
    [3, 5],
    [3, 6],
    [4, 6],
    [4, 7],
    [5, 8],
    [6, 7],
    [2, 8],
  ];

  return (
    <svg viewBox="0 0 520 360" preserveAspectRatio="xMidYMid slice">
      <g className={styles.graphEdges}>
        {gedges.map(([a, b], i) => (
          <line
            key={`e${i}`}
            x1={gnodes[a].x}
            y1={gnodes[a].y}
            x2={gnodes[b].x}
            y2={gnodes[b].y}
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </g>
      <g className={styles.graphNodes}>
        {gnodes.map((n, i) => (
          <circle
            key={`n${i}`}
            cx={n.x}
            cy={n.y}
            r={n.r}
            className={n.key ? styles.isKey : undefined}
            style={{ animationDelay: `${i * 0.22}s` }}
          />
        ))}
      </g>
    </svg>
  );
}

export default App;

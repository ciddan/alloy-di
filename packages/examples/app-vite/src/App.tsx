import { Suspense, use, useEffect, useRef, useState } from "react";

import { createScope, type Scope } from "alloy-di/scopes";
import container, { serviceIdentifiers } from "virtual:alloy-container";
import alloyLogo from "../assets/alloy.svg";
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

const targetLabel =
  typeof __ALLOY_EXAMPLE_TARGET__ === "string"
    ? __ALLOY_EXAMPLE_TARGET__
    : "Vite";

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
    addLog(`Session active: user is ${user.username}`);
  };

  const handleDisposeSession = async () => {
    if (sessionScopeRef.current) {
      addLog("Disposing session scope...");
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
      addLog(
        `[Request Context] Injected SessionUser: ${sessionInfo?.username}`,
      );

      logger.log("Request successfully processed.");
    } finally {
      addLog("Disposing request scope...");
      await requestScope.dispose();
      addLog("Request scope disposed.");
    }
  };

  useEffect(() => {
    analyticsConsumer.initialize("user-12345");
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
      <section className={styles.hero}>
        <div className={styles.heroBg} aria-hidden="true">
          <GraphIllustration />
        </div>
        <div className={styles.heroContent}>
          <span className={styles.pill}>
            <span className={styles.pillDot}></span>
            {targetLabel} example app
          </span>
          <h1>
            Build-time
            <span> dependency injection.</span>
          </h1>
          <p>
            This React demo resolves Alloy services from a generated static
            container, exercises lazy providers, and creates scoped lifecycles
            at runtime.
          </p>
          <div className={styles.actions}>
            <button className={styles.primaryButton} onClick={handleClick}>
              Count is {count}
            </button>
            <button className={styles.secondaryButton} onClick={generateReport}>
              Generate daily report
            </button>
          </div>
        </div>
        <div className={styles.codeWindow}>
          <div className={styles.codeBar}>
            <span></span>
            <span></span>
            <span></span>
            <strong>virtual:alloy-container</strong>
          </div>
          <pre>
            <span className={styles.codeAccent}>const</span> service ={" "}
            <span className={styles.codeCall}>await</span> container.get(id)
            {"\n"}
            <span className={styles.codeAccent}>const</span> scope =
            createScope(container,{" "}
            <span className={styles.codeString}>"session"</span>){"\n"}
            <span className={styles.codeAccent}>const</span> request =
            scope.createScope(
            <span className={styles.codeString}>"request"</span>)
          </pre>
        </div>
      </section>

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

      <footer className={styles.footer}>
        <img src={alloyLogo} alt="" width={24} height={24} />
        <span>DI powered by alloy-di</span>
      </footer>
    </main>
  );
}

function GraphIllustration() {
  return (
    <svg viewBox="0 0 520 360" preserveAspectRatio="xMidYMid slice">
      <g className={styles.graphEdges}>
        <line x1="150" y1="92" x2="272" y2="56"></line>
        <line x1="150" y1="92" x2="272" y2="150"></line>
        <line x1="150" y1="214" x2="272" y2="150"></line>
        <line x1="150" y1="214" x2="272" y2="252"></line>
        <line x1="272" y1="56" x2="392" y2="104"></line>
        <line x1="272" y1="150" x2="392" y2="104"></line>
        <line x1="272" y1="150" x2="392" y2="206"></line>
        <line x1="272" y1="252" x2="392" y2="206"></line>
        <line x1="272" y1="252" x2="392" y2="300"></line>
        <line x1="392" y1="104" x2="452" y2="58"></line>
        <line x1="392" y1="206" x2="392" y2="300"></line>
        <line x1="272" y1="56" x2="452" y2="58"></line>
      </g>
      <g className={styles.graphNodes}>
        <circle cx="150" cy="92" r="4"></circle>
        <circle cx="150" cy="214" r="4"></circle>
        <circle cx="272" cy="56" r="4"></circle>
        <circle cx="272" cy="150" r="6"></circle>
        <circle cx="272" cy="252" r="4"></circle>
        <circle cx="392" cy="104" r="5"></circle>
        <circle cx="392" cy="206" r="4"></circle>
        <circle cx="392" cy="300" r="4"></circle>
        <circle cx="452" cy="58" r="3"></circle>
      </g>
    </svg>
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

export default App;

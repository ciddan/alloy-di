import { Suspense, use, useEffect, useState, useRef } from "react";

import container, { serviceIdentifiers } from "virtual:alloy-container";
import { createScope, type Scope } from "alloy-di/scopes";
import { SessionUser } from "./lib/session-user";
import { RequestLogger } from "./lib/request-logger";
import alloyLogo from "../assets/alloy.svg";
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

  // Scopes Demo State
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
      addLog("Error: No active session scope!");
      return;
    }

    addLog("Simulating incoming HTTP request...");
    addLog("Creating child request scope from session scope...");
    const requestScope = sessionScopeRef.current.createScope("request");

    try {
      addLog(
        "Resolving RequestLogger from request scope (bubbles up to resolve SessionUser from parent)...",
      );
      const logger = await requestScope.get(RequestLogger);

      logger.log("Handling API request to /api/dashboard");
      addLog(
        `[Request Context] Logger initialized with ID: ${logger.requestId}`,
      );
      addLog(
        `[Request Context] Injected SessionUser: ${sessionInfo?.username}`,
      );

      logger.log("Request successfully processed.");
    } finally {
      addLog("Disposing request scope (reverse teardown)...");
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
  };

  return (
    <div className={styles.container}>
      <img
        src={alloyLogo}
        alt="Alloy logo"
        width={256}
        height={256}
        style={{ marginBottom: "1rem" }}
      />
      <h1 className={styles.title}>Vite + Alloy</h1>
      <div className={styles.card}>
        <button className={styles.button} onClick={handleClick}>
          count is {count}
        </button>
        <button
          className={styles.button}
          style={{ marginLeft: "10px" }}
          onClick={generateReport}
        >
          Generate Daily Report
        </button>
      </div>
      <p>{appService.getValue()}</p>
      <p>{consumerService.getLazyMessage()}</p>
      <p>{analyticsConsumer.getSessionInfo()}</p>
      <p>Reporting ready (lazy Analytics resolved on demand).</p>

      {/* Hierarchical Scopes Demo */}
      <div className={styles.demoSection}>
        <h2 className={styles.demoTitle}>
          Hierarchical Scopes (Custom Lifecycles) Demo
        </h2>
        <p style={{ color: "#a0a0b8", marginBottom: "1.5rem" }}>
          Demonstrates runtime parent-child scope creation, resolution bubbling,
          and ordered disposal lifecycle.
        </p>

        <div className={styles.demoCard}>
          <div>
            <span className={styles.statusLabel}>Session Status:</span>
            {sessionInfo ? (
              <span style={{ color: "#00ff66", fontWeight: "bold" }}>
                Active
              </span>
            ) : (
              <span style={{ color: "#ff3366", fontWeight: "bold" }}>
                Inactive
              </span>
            )}
          </div>
          {sessionInfo && (
            <div style={{ marginTop: "0.5rem" }}>
              <div>
                <span className={styles.statusLabel}>Session User:</span>
                <span className={styles.statusValue}>
                  {sessionInfo.username}
                </span>
              </div>
              <div style={{ marginTop: "0.25rem" }}>
                <span className={styles.statusLabel}>Created At:</span>
                <span className={styles.statusValue}>
                  {sessionInfo.createdAt}
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "1.5rem" }}>
          <button className={styles.button} onClick={handleCreateSession}>
            {sessionInfo ? "Restart Session" : "Create Session Scope"}
          </button>
          <button
            className={styles.button}
            onClick={handleDisposeSession}
            disabled={!sessionInfo}
            style={{ opacity: sessionInfo ? 1 : 0.5 }}
          >
            Dispose Session
          </button>
          <button
            className={styles.button}
            onClick={handleSimulatedRequest}
            disabled={!sessionInfo}
            style={{ opacity: sessionInfo ? 1 : 0.5 }}
          >
            Simulate Scoped Request
          </button>
        </div>

        <div>
          <span className={styles.statusLabel}>Scope Lifecycle Event Log:</span>
          <div className={styles.logsContainer}>
            {logs.length === 0 ? (
              <div style={{ color: "#666" }}>
                No events logged yet. Click buttons above to start.
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={styles.logEntry}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <p className={styles.readTheDocs} style={{ marginTop: "2rem" }}>
        DI powered by alloy-di
      </p>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<div className={styles.card}>Loading services…</div>}>
      <AppContent />
    </Suspense>
  );
}

export default App;

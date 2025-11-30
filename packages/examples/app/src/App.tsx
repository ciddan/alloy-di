import { Suspense, use, useEffect, useState } from "react";

import container, { serviceIdentifiers } from "virtual:alloy-container";
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

  useEffect(() => {
    analyticsConsumer.initialize("user-12345");
    return () => analyticsConsumer.shutdown();
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
      <h1 className={styles.title}>Vite + React</h1>
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
      <p className={styles.readTheDocs}>DI powered by alloy-di</p>
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

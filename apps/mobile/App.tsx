import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { HazardReportScreen } from "./src/features/hazard-reporting/screens/HazardReportScreen";
import { SplashScreen } from "./src/features/hazard-reporting/components/SplashScreen";

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Show the logo for 2 seconds, then open the report form.
    const timer = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) {
    return (
      <>
        <StatusBar style="light" />
        <SplashScreen />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <HazardReportScreen />
    </>
  );
}

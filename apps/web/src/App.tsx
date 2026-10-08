import { PROJECT_NAME } from "@disaster/config";
import { useEffect, useState } from "react";

import { BroadcastHazardDashboard } from "./features/hazard-broadcast/BroadcastHazardDashboard";
import type { BroadcastApi } from "./features/hazard-broadcast/broadcast-api";
import {
  ReliefAllocationFeature,
  type ReliefAllocationFeatureProps,
} from "./features/relief-allocation/ReliefAllocationFeature";
import { VerificationDashboard } from "./features/verification/VerificationDashboard";
import type { VerificationApi } from "./features/verification/verification-api";

const officerAreas = [
  {
    title: "DMC Duty Officer",
    description: "Hazard verification and alert-broadcast operations workspace.",
  },
  {
    title: "District Officer",
    description: "District-scoped relief allocation is available under /relief.",
  },
] as const;

export interface AppProps extends ReliefAllocationFeatureProps {
  readonly verificationApi?: VerificationApi | undefined;
  readonly broadcastApi?: BroadcastApi | undefined;
  readonly initialView?: "verification" | "broadcast";
}

export function App({
  verificationApi,
  broadcastApi,
  initialView = "verification",
  api,
  initialPath,
  createIdempotencyKey,
}: AppProps) {
  const [currentView, setCurrentView] = useState<"verification" | "broadcast">(initialView);
  const [browserPath, setBrowserPath] = useState(() => window.location.pathname);
  const path = initialPath ?? browserPath;
  const normalizedPath = path.replace(/\/+$/, "") || "/";
  const isReliefPath = normalizedPath === "/relief" || normalizedPath.startsWith("/relief/");

  useEffect(() => {
    if (initialPath !== undefined) return;
    const onPopState = () => setBrowserPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialPath]);

  if (isReliefPath) {
    return (
      <ReliefAllocationFeature
        {...(api === undefined ? {} : { api })}
        {...(initialPath === undefined ? {} : { initialPath })}
        {...(createIdempotencyKey === undefined ? {} : { createIdempotencyKey })}
      />
    );
  }

  return (
    <main className="dmc-shell">
      <header className="dmc-header">
        <p className="eyebrow">SE3070 Assignment 02</p>
        <h1>{PROJECT_NAME}</h1>
        <p className="lede">DMC Duty Officer Workspace</p>
        <nav className="officer-nav" aria-label="Officer Workspace Navigation">
          <button
            type="button"
            className={`nav-tab ${currentView === "verification" ? "active" : ""}`}
            aria-selected={currentView === "verification"}
            onClick={() => setCurrentView("verification")}
          >
            Hazard Verification
          </button>
          <button
            type="button"
            className={`nav-tab ${currentView === "broadcast" ? "active" : ""}`}
            aria-selected={currentView === "broadcast"}
            onClick={() => setCurrentView("broadcast")}
          >
            Broadcast Hazard Alert
          </button>
        </nav>
      </header>

      {currentView === "verification" ? (
        verificationApi ? (
          <VerificationDashboard api={verificationApi} />
        ) : (
          <section aria-label="Officer areas" className="areas">
            {officerAreas.map((area) => (
              <article key={area.title}>
                <h2>{area.title}</h2>
                <p>{area.description}</p>
                <span>Officer workspace</span>
              </article>
            ))}
          </section>
        )
      ) : (
        <BroadcastHazardDashboard api={broadcastApi} />
      )}
    </main>
  );
}

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
    <div className="app-shell">
      {/* Top Navigation Bar */}
      <header className="top-nav" role="banner">
        <div className="top-nav__inner">
          <div className="top-nav__brand">
            <span className="top-nav__badge" aria-label="System status active">
              <span className="top-nav__pulse" aria-hidden="true" />
              LIVE
            </span>
            <div className="top-nav__titles">
              <span className="top-nav__system">SE3070 · Assignment 02</span>
              <span className="top-nav__name">{PROJECT_NAME}</span>
            </div>
          </div>

          <nav className="top-nav__tabs" aria-label="Officer workspace navigation">
            <button
              id="nav-verification"
              type="button"
              role="tab"
              aria-selected={currentView === "verification"}
              className={`top-nav__tab ${currentView === "verification" ? "is-active" : ""}`}
              onClick={() => setCurrentView("verification")}
            >
              <svg
                className="top-nav__tab-icon"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 12l2 2 4-4" />
                <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.51 0 2.93.37 4.18 1.03" />
              </svg>
              Hazard Verification
            </button>
            <button
              id="nav-broadcast"
              type="button"
              role="tab"
              aria-selected={currentView === "broadcast"}
              className={`top-nav__tab ${currentView === "broadcast" ? "is-active" : ""}`}
              onClick={() => setCurrentView("broadcast")}
            >
              <svg
                className="top-nav__tab-icon"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 20h.01" />
                <path d="M7 20v-4" />
                <path d="M12 20v-8" />
                <path d="M17 20V8" />
                <path d="M22 4v16" />
              </svg>
              Broadcast Alert
            </button>
          </nav>

          <div className="top-nav__meta" aria-label="Operator context">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            DMC Duty Officer
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main className="app-main">
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
    </div>
  );
}

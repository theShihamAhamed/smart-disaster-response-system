import { useState } from "react";
import { PROJECT_NAME } from "@disaster/config";
import { VerificationDashboard } from "./features/verification/VerificationDashboard";
import type { VerificationApi } from "./features/verification/verification-api";
import { BroadcastHazardDashboard } from "./features/hazard-broadcast/BroadcastHazardDashboard";
import type { BroadcastApi } from "./features/hazard-broadcast/broadcast-api";

const officerAreas = [
  {
    title: "DMC Duty Officer",
    description: "Foundation for later hazard verification and alert broadcasting modules.",
  },
  {
    title: "District Officer",
    description: "Foundation for the later district-scoped relief allocation module.",
  },
] as const;

export function App({
  verificationApi,
  broadcastApi,
  initialView = "verification",
}: {
  readonly verificationApi?: VerificationApi | undefined;
  readonly broadcastApi?: BroadcastApi | undefined;
  readonly initialView?: "verification" | "broadcast";
}) {
  const [currentView, setCurrentView] = useState<"verification" | "broadcast">(initialView);

  return (
    <main>
      <header>
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
                <span>Phase 0 shell</span>
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

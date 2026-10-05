import { PROJECT_NAME } from "@disaster/config";
import { VerificationDashboard } from "./features/verification/VerificationDashboard";
import type { VerificationApi } from "./features/verification/verification-api";

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

export function App({ verificationApi }: { readonly verificationApi?: VerificationApi }) {
  return (
    <main>
      <header>
        <p className="eyebrow">SE3070 Assignment 02</p>
        <h1>{PROJECT_NAME}</h1>
        <p className="lede">Officer application foundation</p>
      </header>
      {verificationApi ? (
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
      )}
      <p className="boundary">
        Assessed verification, broadcasting and relief-allocation workflows are intentionally not
        implemented in this phase.
      </p>
    </main>
  );
}

import { PROJECT_NAME } from "@disaster/config";
import { useEffect, useState, type MouseEvent } from "react";

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
}

type AppModule = "verification" | "broadcast" | "relief";

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function resolveModule(pathname: string): AppModule {
  if (pathname === "/broadcast") return "broadcast";
  if (pathname === "/relief" || pathname.startsWith("/relief/")) return "relief";
  return "verification";
}

const navigationItems = [
  { module: "verification", href: "/", label: "Hazard Verification", role: "DMC Duty Officer" },
  {
    module: "broadcast",
    href: "/broadcast",
    label: "Broadcast Alert",
    role: "DMC Duty Officer with broadcast permission",
  },
  {
    module: "relief",
    href: "/relief",
    label: "Resource Allocation",
    role: "District Officer",
  },
] as const;

export function App({
  verificationApi,
  broadcastApi,
  api,
  initialPath,
  createIdempotencyKey,
}: AppProps) {
  const [path, setPath] = useState(() => normalizePath(initialPath ?? window.location.pathname));
  const currentModule = resolveModule(path);

  useEffect(() => {
    if (initialPath !== undefined) return;
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialPath]);

  useEffect(() => {
    if (initialPath !== undefined) setPath(normalizePath(initialPath));
  }, [initialPath]);

  function navigate(nextPath: string) {
    const normalized = normalizePath(nextPath);
    if (initialPath === undefined && normalizePath(window.location.pathname) !== normalized) {
      window.history.pushState({}, "", normalized);
    }
    setPath(normalized);
  }

  function navigateFromLink(event: MouseEvent<HTMLAnchorElement>, nextPath: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(nextPath);
  }

  const requiredRole = navigationItems.find(({ module }) => module === currentModule)?.role;

  return (
    <div className="dmc-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="dmc-header" role="banner">
        <div className="dmc-header__inner">
          <div className="dmc-brand">
            <div className="dmc-brand__copy">
              <strong className="dmc-brand__system">DMC Sri Lanka</strong>
              <span className="dmc-brand__name">{PROJECT_NAME}</span>
            </div>
          </div>

          <nav className="dmc-nav" aria-label="Officer workspace navigation">
            {navigationItems.map((item) => (
              <a
                key={item.module}
                className={`dmc-nav__item ${currentModule === item.module ? "is-active" : ""}`}
                href={item.href}
                aria-current={currentModule === item.module ? "page" : undefined}
                onClick={(event) => navigateFromLink(event, item.href)}
              >
                <span>{item.label}</span>
                <small>{item.role}</small>
              </a>
            ))}
          </nav>

          <div className="dmc-role" aria-label="Required workspace role">
            <span aria-hidden="true">ROLE</span>
            <div>
              <small>Required workspace role</small>
              <strong>{requiredRole}</strong>
            </div>
          </div>
        </div>
      </header>

      <main
        className={`app-main ${currentModule === "relief" ? "app-main--relief" : ""}`}
        id="main-content"
      >
        {currentModule === "verification" ? (
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
        ) : currentModule === "broadcast" ? (
          <BroadcastHazardDashboard api={broadcastApi} />
        ) : (
          <ReliefAllocationFeature
            {...(api === undefined ? {} : { api })}
            initialPath={path}
            navigate={navigate}
            {...(createIdempotencyKey === undefined ? {} : { createIdempotencyKey })}
          />
        )}
      </main>
    </div>
  );
}

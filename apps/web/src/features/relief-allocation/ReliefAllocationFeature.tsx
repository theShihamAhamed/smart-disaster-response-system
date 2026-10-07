import { PROJECT_NAME } from "@disaster/config";
import { useEffect, useState } from "react";

import { sharedReliefAllocationClient } from "../../shared-api-client";
import { ReliefQueuePage } from "./ReliefQueuePage";
import { ReliefWorkspacePage } from "./ReliefWorkspacePage";
import type { ReliefAllocationApi } from "./relief-ui";

export interface ReliefAllocationFeatureProps {
  readonly api?: ReliefAllocationApi;
  readonly initialPath?: string;
  readonly createIdempotencyKey?: () => string;
}

type ReliefRoute = { readonly kind: "QUEUE" } | { readonly kind: "WORKSPACE"; requestId: string };

function parseRoute(pathname: string): ReliefRoute {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/" || normalized === "/relief") return { kind: "QUEUE" };
  const match = /^\/relief\/([^/]+)$/.exec(normalized);
  if (match?.[1]) return { kind: "WORKSPACE", requestId: decodeURIComponent(match[1]) };
  return { kind: "QUEUE" };
}

function browserIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function ReliefAllocationFeature({
  api = sharedReliefAllocationClient,
  initialPath,
  createIdempotencyKey = browserIdempotencyKey,
}: ReliefAllocationFeatureProps) {
  const [path, setPath] = useState(initialPath ?? window.location.pathname);
  const route = parseRoute(path);

  useEffect(() => {
    if (initialPath !== undefined) return;
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialPath]);

  function navigate(nextPath: string) {
    if (initialPath === undefined) {
      window.history.pushState({}, "", nextPath);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    }
    setPath(nextPath);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <button className="brand-button" type="button" onClick={() => navigate("/relief")}>
          <span className="brand-mark" aria-hidden="true">
            SR
          </span>
          <span>
            <strong>{PROJECT_NAME}</strong>
            <small>District Operations</small>
          </span>
        </button>
        <nav aria-label="Officer navigation">
          <button className="nav-item nav-item--active" onClick={() => navigate("/relief")}>
            Relief allocation
          </button>
        </nav>
        <div className="officer-chip" aria-label="Authenticated role">
          <span aria-hidden="true">DO</span>
          <div>
            <strong>District Officer</strong>
            <small>Development identity</small>
          </div>
        </div>
      </header>

      {route.kind === "QUEUE" ? (
        <ReliefQueuePage
          api={api}
          openRequest={(requestId) => navigate(`/relief/${encodeURIComponent(requestId)}`)}
        />
      ) : (
        <ReliefWorkspacePage
          key={route.requestId}
          api={api}
          requestId={route.requestId}
          createIdempotencyKey={createIdempotencyKey}
          goToQueue={() => navigate("/relief")}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";

import { sharedReliefAllocationClient } from "../../shared-api-client";
import { ReliefQueuePage } from "./ReliefQueuePage";
import { ReliefWorkspacePage } from "./ReliefWorkspacePage";
import type { ReliefAllocationApi } from "./relief-ui";

export interface ReliefAllocationFeatureProps {
  readonly api?: ReliefAllocationApi;
  readonly initialPath?: string;
  readonly createIdempotencyKey?: () => string;
  readonly navigate?: (path: string) => void;
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
  navigate: navigateInShell,
}: ReliefAllocationFeatureProps) {
  const [path, setPath] = useState(initialPath ?? window.location.pathname);
  const [queueRefreshToken, setQueueRefreshToken] = useState(0);
  const route = parseRoute(path);

  useEffect(() => {
    if (initialPath !== undefined) setPath(initialPath);
  }, [initialPath]);

  function navigate(nextPath: string) {
    navigateInShell?.(nextPath);
    setPath(nextPath);
  }

  function returnToQueue() {
    setQueueRefreshToken((value) => value + 1);
    navigate("/relief");
  }

  return (
    <section className="relief-feature" aria-label="Relief resource allocation">
      <div className="relief-feature__heading">
        <div>
          <p className="relief-kicker">DMC district operations</p>
          <h1>Relief resource allocation</h1>
        </div>
        <p>Review ranked shelter needs and prepare a verified allocation.</p>
      </div>

      <div className="relief-dashboard">
        <ReliefQueuePage
          api={api}
          openRequest={(requestId) => navigate(`/relief/${encodeURIComponent(requestId)}`)}
          selectedRequestId={route.kind === "WORKSPACE" ? route.requestId : undefined}
          refreshToken={queueRefreshToken}
        />

        {route.kind === "QUEUE" ? (
          <section className="relief-selection-prompt" aria-labelledby="relief-selection-title">
            <span aria-hidden="true">01</span>
            <p className="relief-kicker">Allocation workspace</p>
            <h2 id="relief-selection-title">Select a relief request</h2>
            <p>
              Choose a ranked shelter request to inspect demand, warehouse stock and available
              response support.
            </p>
          </section>
        ) : (
          <ReliefWorkspacePage
            key={route.requestId}
            api={api}
            requestId={route.requestId}
            createIdempotencyKey={createIdempotencyKey}
            goToQueue={returnToQueue}
          />
        )}
      </div>
    </section>
  );
}

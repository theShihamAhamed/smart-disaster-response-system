import { ApiClientError } from "@disaster/api-client";
import {
  ReliefRequestStatus,
  ZoneSeverity,
  type ReliefRequestStatus as ReliefRequestStatusValue,
  type ZoneSeverity as ZoneSeverityValue,
} from "@disaster/domain";
import type { ReliefRequestQueueItem } from "@disaster/shared-types";
import { useEffect, useState } from "react";

import {
  formatDateTime,
  formatSeverity,
  formatSupplyType,
  humanizeConstant,
  type ReliefAllocationApi,
} from "./relief-ui";

interface ReliefQueuePageProps {
  readonly api: ReliefAllocationApi;
  readonly openRequest: (requestId: string) => void;
  readonly selectedRequestId?: string | undefined;
  readonly refreshToken?: number;
}

type QueueState =
  | { readonly kind: "LOADING" }
  | { readonly kind: "ERROR" }
  | { readonly kind: "ACCESS_DENIED" }
  | { readonly kind: "READY"; readonly requests: readonly ReliefRequestQueueItem[] };

const statuses = Object.values(ReliefRequestStatus);
const severities = Object.values(ZoneSeverity);

export function ReliefQueuePage({
  api,
  openRequest,
  selectedRequestId,
  refreshToken = 0,
}: ReliefQueuePageProps) {
  const [status, setStatus] = useState<ReliefRequestStatusValue | "">("");
  const [severity, setSeverity] = useState<ZoneSeverityValue | "">("");
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<QueueState>({ kind: "LOADING" });

  useEffect(() => {
    let current = true;
    setState({ kind: "LOADING" });
    void api
      .listReliefRequests({
        ...(status ? { status } : {}),
        ...(severity ? { zoneSeverity: severity } : {}),
      })
      .then((requests) => {
        if (current) setState({ kind: "READY", requests });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState(
          error instanceof ApiClientError && (error.status === 401 || error.status === 403)
            ? { kind: "ACCESS_DENIED" }
            : { kind: "ERROR" },
        );
      });
    return () => {
      current = false;
    };
  }, [api, refreshToken, reloadToken, severity, status]);

  return (
    <aside className="relief-queue" aria-labelledby="relief-queue-heading">
      <div className="relief-queue__header">
        <div>
          <p className="relief-kicker">District priority queue</p>
          <h1 id="relief-queue-heading">Shelters needing supply</h1>
        </div>
        <div className="relief-queue__count" aria-label="Actionable request count">
          <span>{state.kind === "READY" ? state.requests.length : "—"}</span>
        </div>
      </div>

      <section className="relief-queue__filters" aria-label="Relief request filters">
        <div className="field-group">
          <label htmlFor="status-filter">Request status</label>
          <select
            id="status-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as ReliefRequestStatusValue | "")}
          >
            <option value="">All actionable statuses</option>
            {statuses
              .filter((value) => value !== ReliefRequestStatus.ALLOCATED)
              .map((value) => (
                <option key={value} value={value}>
                  {humanizeConstant(value)}
                </option>
              ))}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="severity-filter">Zone severity</label>
          <select
            id="severity-filter"
            value={severity}
            onChange={(event) => setSeverity(event.target.value as ZoneSeverityValue | "")}
          >
            <option value="">All severities</option>
            {severities.map((value) => (
              <option key={value} value={value}>
                {formatSeverity(value)}
              </option>
            ))}
          </select>
        </div>
        {(status || severity) && (
          <button
            className="relief-button relief-button--quiet relief-queue__filter-reset"
            type="button"
            onClick={() => {
              setStatus("");
              setSeverity("");
            }}
          >
            Clear filters
          </button>
        )}
      </section>

      {state.kind === "LOADING" && (
        <section className="state-panel" aria-live="polite" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h2>Loading ranked requests</h2>
          <p>Checking current shelter needs and outstanding supplies.</p>
        </section>
      )}

      {state.kind === "ERROR" && (
        <section className="relief-queue__state relief-queue__state--error" role="alert">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <h2>Relief requests could not be loaded</h2>
          <p>Check the API connection and try loading the district queue again.</p>
          <button
            className="relief-button relief-button--primary"
            onClick={() => setReloadToken((v) => v + 1)}
          >
            Retry loading
          </button>
        </section>
      )}

      {state.kind === "ACCESS_DENIED" && (
        <section className="relief-queue__state relief-queue__state--error" role="alert">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <h2>District Officer access required</h2>
          <p>
            Resource Allocation requires a configured District Officer development identity. The API
            remains the authority for access.
          </p>
        </section>
      )}

      {state.kind === "READY" && state.requests.length === 0 && (
        <section className="relief-queue__state">
          <span className="state-icon state-icon--calm" aria-hidden="true">
            ✓
          </span>
          <h2>No matching actionable requests</h2>
          <p>
            The district queue is currently clear for these filters. Change a filter or check again
            later.
          </p>
        </section>
      )}

      {state.kind === "READY" && state.requests.length > 0 && (
        <section className="relief-queue__list" aria-label="Ranked relief requests">
          <p className="relief-queue__ranking-note">
            Server-ranked by severity, shelter pressure, then age.
          </p>
          <div>
            {state.requests.map((request, index) => (
              <RequestCard
                key={request.requestId}
                request={request}
                rank={index + 1}
                openRequest={openRequest}
                selected={request.requestId === selectedRequestId}
              />
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

function RequestCard({
  request,
  rank,
  openRequest,
  selected,
}: {
  readonly request: ReliefRequestQueueItem;
  readonly rank: number;
  readonly openRequest: (requestId: string) => void;
  readonly selected: boolean;
}) {
  const occupancyPercentage = Math.round(request.shelter.occupancyRate * 100);
  return (
    <article
      className={`request-card relief-request ${selected ? "is-selected" : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="request-card__topline">
        <span className="rank-badge">Priority {rank}</span>
        <span
          className={`severity-badge severity-badge--${request.targetZone.severity.toLowerCase()}`}
        >
          {formatSeverity(request.targetZone.severity)} severity
        </span>
      </div>
      <div className="request-card__heading">
        <div>
          <p>{request.targetZone.name}</p>
          <h3>{request.shelter.name}</h3>
        </div>
        <span className="status-badge">{humanizeConstant(request.status)}</span>
      </div>
      <div className="occupancy-block">
        <div className="occupancy-block__label">
          <span>Shelter occupancy</span>
          <strong>
            {request.shelter.currentOccupancy}/{request.shelter.capacity} ({occupancyPercentage}%)
          </strong>
        </div>
        <div
          className="occupancy-meter"
          role="meter"
          aria-label={`${request.shelter.name} occupancy`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, occupancyPercentage)}
        >
          <span style={{ width: `${Math.min(100, occupancyPercentage)}%` }} />
        </div>
      </div>
      <div className="supply-summary">
        <p>Outstanding demand</p>
        <ul>
          {request.outstandingSupplies.map((item) => (
            <li key={item.supplyType}>
              <span>{formatSupplyType(item.supplyType)}</span>
              <strong>{item.outstandingQty} units</strong>
            </li>
          ))}
        </ul>
      </div>
      <div className="request-card__footer">
        <span>Requested {formatDateTime(request.createdAt)}</span>
        <button
          className="relief-request__open"
          type="button"
          onClick={() => openRequest(request.requestId)}
          aria-label={`Open allocation workspace for ${request.shelter.name}`}
        >
          {selected ? "Selected request" : "Review request"}
        </button>
      </div>
    </article>
  );
}

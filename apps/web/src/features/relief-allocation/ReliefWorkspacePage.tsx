import { ApiClientError } from "@disaster/api-client";
import { ZoneSeverity } from "@disaster/domain";
import type { ReliefAllocationCommand, ReliefAllocationReceipt } from "@disaster/shared-types";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createInitialDraft,
  draftQuantity,
  formatDateTime,
  formatSeverity,
  formatSupplyType,
  humanizeConstant,
  itemMaximum,
  previewRequestStatus,
  previewShortage,
  validateDraft,
  type AllocationDraft,
  type ReliefAllocationApi,
} from "./relief-ui";

interface ReliefWorkspacePageProps {
  readonly api: ReliefAllocationApi;
  readonly requestId: string;
  readonly createIdempotencyKey: () => string;
  readonly goToQueue: () => void;
}

interface AllocationAttempt {
  readonly idempotencyKey: string;
  readonly command: ReliefAllocationCommand;
}

type ConflictCode =
  | "STOCK_CHANGED"
  | "REQUEST_CHANGED"
  | "REQUEST_ALREADY_ALLOCATED"
  | "TEAM_UNAVAILABLE"
  | "PARTNER_REQUIRED"
  | "IDEMPOTENCY_MISMATCH";

type WorkspacePhase =
  | "LOADING"
  | "LOAD_ERROR"
  | "EDITING"
  | "CONFIRMING"
  | "SUBMITTING"
  | "RECOVERING"
  | "RECOVERY_NOT_FOUND"
  | "UNCERTAIN"
  | "SUCCESS"
  | "CONFLICT"
  | "FAILURE";

const conflictContent: Readonly<Record<ConflictCode, { title: string; message: string }>> = {
  STOCK_CHANGED: {
    title: "Warehouse stock changed",
    message:
      "Warehouse stock changed while you were reviewing this request. Refresh the request and review the allocation again.",
  },
  REQUEST_CHANGED: {
    title: "Relief request changed",
    message:
      "This relief request changed while you were reviewing it. Reload the latest request before allocating resources.",
  },
  REQUEST_ALREADY_ALLOCATED: {
    title: "Request already allocated",
    message: "This request has already been fully allocated.",
  },
  TEAM_UNAVAILABLE: {
    title: "Rescue team unavailable",
    message:
      "The selected rescue team is no longer available. Reload the request and select another available team.",
  },
  PARTNER_REQUIRED: {
    title: "Partner selection required",
    message: "A valid partner organisation is required for each remaining shortage.",
  },
  IDEMPOTENCY_MISMATCH: {
    title: "Allocation attempt cannot be resumed",
    message: "Restart and review this allocation before submitting it again.",
  },
};

function isConflictCode(value: string): value is ConflictCode {
  return value in conflictContent;
}

export function ReliefWorkspacePage({
  api,
  requestId,
  createIdempotencyKey,
  goToQueue,
}: ReliefWorkspacePageProps) {
  const [phase, setPhase] = useState<WorkspacePhase>("LOADING");
  const [reloadToken, setReloadToken] = useState(0);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof api.getReliefRequest>> | null>(
    null,
  );
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const [attempt, setAttempt] = useState<AllocationAttempt | null>(null);
  const [receipt, setReceipt] = useState<ReliefAllocationReceipt | null>(null);
  const [recoveredReceipt, setRecoveredReceipt] = useState(false);
  const [conflictCode, setConflictCode] = useState<ConflictCode | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const submissionInFlight = useRef(false);
  const recoveryInFlight = useRef(false);

  useEffect(() => {
    let current = true;
    setPhase("LOADING");
    setDetails(null);
    setDraft(null);
    setAttempt(null);
    setReceipt(null);
    setConflictCode(null);
    setShowValidation(false);
    void api
      .getReliefRequest(requestId)
      .then((loaded) => {
        if (!current) return;
        setDetails(loaded);
        setDraft(createInitialDraft(loaded));
        setPhase("EDITING");
      })
      .catch(() => {
        if (current) setPhase("LOAD_ERROR");
      });
    return () => {
      current = false;
    };
  }, [api, reloadToken, requestId]);

  useEffect(() => {
    if (phase !== "EDITING" && phase !== "LOADING") statusHeading.current?.focus();
  }, [phase]);

  const validation = useMemo(
    () => (details && draft ? validateDraft(details, draft) : null),
    [details, draft],
  );
  const hasPositiveAllocation = useMemo(
    () =>
      details && draft
        ? details.items.some((item) => (draftQuantity(draft, item.requestItemId) ?? 0) > 0)
        : false,
    [details, draft],
  );

  useEffect(() => {
    if (
      !details ||
      !draft?.rescueTeamId ||
      (details.targetZone.severity === ZoneSeverity.CRITICAL && hasPositiveAllocation)
    ) {
      return;
    }
    setDraft({ ...draft, rescueTeamId: "" });
    setAttempt(null);
  }, [details, draft, hasPositiveAllocation]);

  function updateDraft(next: AllocationDraft) {
    setDraft(next);
    setAttempt(null);
    setShowValidation(false);
  }

  function reloadLatest() {
    setAttempt(null);
    setReceipt(null);
    setReloadToken((value) => value + 1);
  }

  function reviewAllocation() {
    setShowValidation(true);
    if (!validation?.command) return;
    const nextAttempt = attempt ?? {
      idempotencyKey: createIdempotencyKey(),
      command: validation.command,
    };
    setAttempt(nextAttempt);
    setPhase("CONFIRMING");
  }

  function handleServerResponseError(error: ApiClientError): boolean {
    const code = error.body.error.code;
    if (isConflictCode(code)) {
      setConflictCode(code);
      setPhase("CONFLICT");
      return true;
    }
    if (error.status < 500) {
      setFailureMessage(error.body.error.message || "The allocation command was not accepted.");
      setPhase("FAILURE");
      return true;
    }
    return false;
  }

  async function recoverAllocation(activeAttempt: AllocationAttempt) {
    if (recoveryInFlight.current) return;
    recoveryInFlight.current = true;
    setPhase("RECOVERING");
    try {
      const recovered = await api.getReliefAllocationByIdempotencyKey(activeAttempt.idempotencyKey);
      setReceipt(recovered);
      setRecoveredReceipt(true);
      setPhase("SUCCESS");
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) {
        setPhase("RECOVERY_NOT_FOUND");
      } else {
        setPhase("UNCERTAIN");
      }
    } finally {
      recoveryInFlight.current = false;
    }
  }

  async function submitAllocation() {
    if (!attempt || submissionInFlight.current) return;
    submissionInFlight.current = true;
    setPhase("SUBMITTING");
    try {
      const committed = await api.createReliefAllocation(
        requestId,
        attempt.command,
        attempt.idempotencyKey,
      );
      setReceipt(committed);
      setRecoveredReceipt(false);
      setPhase("SUCCESS");
    } catch (error) {
      if (error instanceof ApiClientError && handleServerResponseError(error)) return;
      await recoverAllocation(attempt);
    } finally {
      submissionInFlight.current = false;
    }
  }

  if (phase === "LOADING") {
    return (
      <main className="page-shell" id="main-content">
        <WorkspaceBackButton goToQueue={goToQueue} />
        <section className="state-panel" aria-live="polite" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h1>Loading allocation workspace</h1>
          <p>Refreshing request demand, warehouse stock, partners, and available teams.</p>
        </section>
      </main>
    );
  }

  if (phase === "LOAD_ERROR" || !details || !draft) {
    return (
      <main className="page-shell" id="main-content">
        <WorkspaceBackButton goToQueue={goToQueue} />
        <section className="state-panel state-panel--error" role="alert">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <h1>Request workspace could not be loaded</h1>
          <p>The latest request details are unavailable. No allocation has been submitted.</p>
          <div className="button-row">
            <button className="button button--primary" onClick={reloadLatest}>
              Retry request
            </button>
            <button className="button button--secondary" onClick={goToQueue}>
              Back to queue
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "SUCCESS" && receipt) {
    return (
      <ReceiptView
        receipt={receipt}
        recovered={recoveredReceipt}
        goToQueue={goToQueue}
        viewUpdatedRequest={reloadLatest}
      />
    );
  }

  if (phase === "CONFLICT" && conflictCode) {
    const content = conflictContent[conflictCode];
    return (
      <main className="page-shell narrow-shell" id="main-content">
        <section className="state-panel state-panel--warning" role="alert">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <h1 ref={statusHeading} tabIndex={-1}>
            {content.title}
          </h1>
          <p>{content.message}</p>
          <div className="button-row">
            {conflictCode === "PARTNER_REQUIRED" ? (
              <button className="button button--primary" onClick={() => setPhase("EDITING")}>
                Return to allocation form
              </button>
            ) : conflictCode === "REQUEST_ALREADY_ALLOCATED" ? (
              <button className="button button--primary" onClick={goToQueue}>
                Return to queue
              </button>
            ) : (
              <button className="button button--primary" onClick={reloadLatest}>
                Reload latest request
              </button>
            )}
            <button className="button button--secondary" onClick={goToQueue}>
              Back to queue
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "SUBMITTING" || phase === "RECOVERING") {
    return (
      <main className="page-shell narrow-shell" id="main-content">
        <section className="state-panel" aria-live="assertive" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h1 ref={statusHeading} tabIndex={-1}>
            {phase === "SUBMITTING" ? "Confirming allocation" : "Checking committed outcome"}
          </h1>
          <p>
            {phase === "SUBMITTING"
              ? "The atomic allocation is being committed. Keep this page open."
              : "Connection was interrupted. Checking whether the allocation was committed…"}
          </p>
        </section>
      </main>
    );
  }

  if (phase === "RECOVERY_NOT_FOUND" && attempt) {
    return (
      <main className="page-shell narrow-shell" id="main-content">
        <section className="state-panel state-panel--warning" role="status">
          <span className="state-icon" aria-hidden="true">
            ?
          </span>
          <h1 ref={statusHeading} tabIndex={-1}>
            No committed allocation was found
          </h1>
          <p>
            The confirmed command can be retried with its existing recovery identity. Review the
            summary before retrying.
          </p>
          <div className="button-row">
            <button className="button button--primary" onClick={() => void submitAllocation()}>
              Retry allocation safely
            </button>
            <button className="button button--secondary" onClick={() => setPhase("CONFIRMING")}>
              Review summary
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "UNCERTAIN" && attempt) {
    return (
      <main className="page-shell narrow-shell" id="main-content">
        <section className="state-panel state-panel--warning" role="alert">
          <span className="state-icon" aria-hidden="true">
            ?
          </span>
          <h1 ref={statusHeading} tabIndex={-1}>
            Allocation outcome is still unknown
          </h1>
          <p>
            Do not start another allocation. Retry recovery to check the existing confirmed attempt.
          </p>
          <button
            className="button button--primary"
            onClick={() => void recoverAllocation(attempt)}
          >
            Retry recovery
          </button>
        </section>
      </main>
    );
  }

  if (phase === "FAILURE") {
    return (
      <main className="page-shell narrow-shell" id="main-content">
        <section className="state-panel state-panel--error" role="alert">
          <span className="state-icon" aria-hidden="true">
            !
          </span>
          <h1 ref={statusHeading} tabIndex={-1}>
            Allocation was not accepted
          </h1>
          <p>{failureMessage || "Review the allocation form and try again."}</p>
          <div className="button-row">
            <button className="button button--primary" onClick={() => setPhase("EDITING")}>
              Return to allocation form
            </button>
            <button className="button button--secondary" onClick={goToQueue}>
              Back to queue
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "CONFIRMING" && attempt) {
    return (
      <ConfirmationView
        details={details}
        draft={draft}
        command={attempt.command}
        submitting={false}
        edit={() => setPhase("EDITING")}
        confirm={() => void submitAllocation()}
        goToQueue={goToQueue}
      />
    );
  }

  return (
    <main className="page-shell" id="main-content">
      <WorkspaceBackButton goToQueue={goToQueue} />
      <section className="workspace-heading">
        <div>
          <p className="eyebrow">Allocation workspace</p>
          <h1>{details.shelter.name}</h1>
          <p className="lede">
            Review the latest demand and allocate only the quantities you can confirm now.
          </p>
        </div>
        <div className="workspace-heading__badges">
          <span
            className={`severity-badge severity-badge--${details.targetZone.severity.toLowerCase()}`}
          >
            {formatSeverity(details.targetZone.severity)} severity
          </span>
          <span className="status-badge">{humanizeConstant(details.status)}</span>
        </div>
      </section>

      <section className="context-grid" aria-label="Request context">
        <article className="context-card">
          <p className="section-kicker">Request overview</p>
          <h2>Current request</h2>
          <dl className="detail-list">
            <div>
              <dt>Created</dt>
              <dd>{formatDateTime(details.createdAt)}</dd>
            </div>
            <div>
              <dt>Request note</dt>
              <dd>{details.priorityNote || "No priority note provided"}</dd>
            </div>
          </dl>
        </article>
        <article className="context-card">
          <p className="section-kicker">Shelter</p>
          <h2>{details.shelter.name}</h2>
          <dl className="metric-pair">
            <div>
              <dt>Occupancy</dt>
              <dd>{details.shelter.currentOccupancy}</dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>{details.shelter.capacity}</dd>
            </div>
          </dl>
          <p className="supporting-text">
            {Math.round(details.shelter.occupancyRate * 100)}% occupied · Read-only shelter data
          </p>
        </article>
        <article className="context-card">
          <p className="section-kicker">Target zone</p>
          <h2>{details.targetZone.name}</h2>
          <p className="location-copy">
            {details.shelter.location.address || "Mapped shelter location"}
          </p>
          <p className="supporting-text">
            {details.shelter.location.latitude.toFixed(4)},{" "}
            {details.shelter.location.longitude.toFixed(4)}
          </p>
        </article>
      </section>

      <section className="workspace-section" aria-labelledby="supply-heading">
        <div className="section-intro">
          <div>
            <p className="section-kicker">Warehouse allocation</p>
            <h2 id="supply-heading">Demand and current stock</h2>
          </div>
          <p>Stock is revalidated when the allocation is confirmed.</p>
        </div>
        <div className="table-scroll">
          <table className="allocation-table">
            <thead>
              <tr>
                <th scope="col">Supply</th>
                <th scope="col">Requested</th>
                <th scope="col">Previously allocated</th>
                <th scope="col">Outstanding demand</th>
                <th scope="col">Available stock</th>
                <th scope="col">Allocate now</th>
              </tr>
            </thead>
            <tbody>
              {details.items.map((item) => {
                const inputId = `quantity-${item.requestItemId}`;
                const error = showValidation
                  ? validation?.quantityErrors[item.requestItemId]
                  : undefined;
                return (
                  <tr key={item.requestItemId}>
                    <th scope="row">{formatSupplyType(item.supplyType)}</th>
                    <td>{item.requestedQty}</td>
                    <td>{item.previouslyAllocatedQty}</td>
                    <td>
                      <strong>{item.outstandingQty}</strong>
                    </td>
                    <td>{item.warehouseStock.availableQty}</td>
                    <td>
                      {item.outstandingQty > 0 ? (
                        <div className="quantity-field">
                          <label className="sr-only" htmlFor={inputId}>
                            Allocate {formatSupplyType(item.supplyType)} now
                          </label>
                          <input
                            id={inputId}
                            type="number"
                            min="0"
                            max={itemMaximum(item)}
                            step="1"
                            inputMode="numeric"
                            value={draft.quantities[item.requestItemId] ?? ""}
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? `${inputId}-error` : undefined}
                            onChange={(event) =>
                              updateDraft({
                                ...draft,
                                quantities: {
                                  ...draft.quantities,
                                  [item.requestItemId]: event.target.value,
                                },
                              })
                            }
                          />
                          <span>max {itemMaximum(item)}</span>
                          {error && (
                            <small id={`${inputId}-error`} className="field-error">
                              {error}
                            </small>
                          )}
                        </div>
                      ) : (
                        <span className="complete-label">Fulfilled</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="shortage-heading">
        <div className="section-intro">
          <div>
            <p className="section-kicker">Partner resupply</p>
            <h2 id="shortage-heading">Remaining shortages</h2>
          </div>
          <p>Each positive shortage needs an eligible district partner.</p>
        </div>
        <div className="shortage-grid">
          {details.items
            .filter((item) => item.outstandingQty > 0)
            .map((item) => {
              const shortage = previewShortage(item, draft);
              const selectId = `partner-${item.requestItemId}`;
              const error = showValidation
                ? validation?.partnerErrors[item.requestItemId]
                : undefined;
              return (
                <article
                  className={`shortage-card ${shortage === 0 ? "shortage-card--covered" : ""}`}
                  key={item.requestItemId}
                >
                  <div>
                    <p>{formatSupplyType(item.supplyType)}</p>
                    <strong>{shortage} units short</strong>
                  </div>
                  {shortage > 0 ? (
                    <div className="field-group">
                      <label htmlFor={selectId}>Resupply partner</label>
                      <select
                        id={selectId}
                        value={draft.partnerIds[item.requestItemId] ?? ""}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${selectId}-error` : undefined}
                        onChange={(event) =>
                          updateDraft({
                            ...draft,
                            partnerIds: {
                              ...draft.partnerIds,
                              [item.requestItemId]: event.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Select an eligible partner</option>
                        {details.eligiblePartners.map((partner) => (
                          <option key={partner.id} value={partner.id}>
                            {partner.name} · {humanizeConstant(partner.type)}
                          </option>
                        ))}
                      </select>
                      {error && (
                        <small id={`${selectId}-error`} className="field-error">
                          {error}
                        </small>
                      )}
                    </div>
                  ) : (
                    <span className="covered-badge">Covered by warehouse allocation</span>
                  )}
                </article>
              );
            })}
        </div>
      </section>

      {details.targetZone.severity === ZoneSeverity.CRITICAL && hasPositiveAllocation && (
        <section className="workspace-section dispatch-panel" aria-labelledby="dispatch-heading">
          <div>
            <p className="section-kicker">Optional critical-zone support</p>
            <h2 id="dispatch-heading">Rescue transport dispatch</h2>
            <p>Select one currently available team, or continue without dispatch.</p>
          </div>
          <div className="field-group dispatch-select">
            <label htmlFor="rescue-team">Available rescue team</label>
            <select
              id="rescue-team"
              value={draft.rescueTeamId}
              onChange={(event) => updateDraft({ ...draft, rescueTeamId: event.target.value })}
            >
              <option value="">No rescue dispatch</option>
              {details.availableRescueTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      <section className="workspace-section" aria-labelledby="history-heading">
        <div className="section-intro">
          <div>
            <p className="section-kicker">Audit context</p>
            <h2 id="history-heading">Previous allocations</h2>
          </div>
        </div>
        {details.previousAllocations.length > 0 ? (
          <div className="history-list">
            {details.previousAllocations.map((allocation) => (
              <article className="history-item" key={allocation.allocationId}>
                <div>
                  <strong>{formatDateTime(allocation.createdAt)}</strong>
                  <span>Allocation …{allocation.allocationId.slice(-8)}</span>
                </div>
                <ul>
                  {allocation.items.map((item) => (
                    <li key={item.requestItemId}>
                      {formatSupplyType(item.supplyType)}: {item.allocatedQty} units
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-inline">No previous warehouse allocation has been committed.</p>
        )}
      </section>

      <section className="workspace-section notes-section" aria-labelledby="notes-heading">
        <div>
          <p className="section-kicker">Optional context</p>
          <h2 id="notes-heading">Allocation notes</h2>
        </div>
        <div className="field-group">
          <label htmlFor="allocation-notes">Notes for this allocation</label>
          <textarea
            id="allocation-notes"
            maxLength={500}
            rows={4}
            value={draft.notes}
            aria-invalid={Boolean(showValidation && validation?.notesError)}
            aria-describedby="notes-help notes-count"
            onChange={(event) => updateDraft({ ...draft, notes: event.target.value })}
          />
          <div className="field-meta">
            <small id="notes-help">Operational context only; notes are not required.</small>
            <small id="notes-count">{draft.notes.length}/500</small>
          </div>
          {showValidation && validation?.notesError && (
            <small className="field-error">{validation.notesError}</small>
          )}
        </div>
      </section>

      <footer className="workspace-actions">
        <div>
          <strong>Ready to review?</strong>
          <span>No changes are submitted until final confirmation.</span>
        </div>
        <button className="button button--primary button--large" onClick={reviewAllocation}>
          Review allocation
        </button>
      </footer>
    </main>
  );
}

function WorkspaceBackButton({ goToQueue }: { readonly goToQueue: () => void }) {
  return (
    <button className="back-link" type="button" onClick={goToQueue}>
      <span aria-hidden="true">←</span> Back to relief requests
    </button>
  );
}

function ConfirmationView({
  details,
  draft,
  command,
  submitting,
  edit,
  confirm,
  goToQueue,
}: {
  readonly details: NonNullable<Awaited<ReturnType<ReliefAllocationApi["getReliefRequest"]>>>;
  readonly draft: AllocationDraft;
  readonly command: ReliefAllocationCommand;
  readonly submitting: boolean;
  readonly edit: () => void;
  readonly confirm: () => void;
  readonly goToQueue: () => void;
}) {
  const partnerName = (partnerId: string) =>
    details.eligiblePartners.find(({ id }) => id === partnerId)?.name ?? "Selected partner";
  const teamName = details.availableRescueTeams.find(({ id }) => id === command.rescueTeamId)?.name;

  return (
    <main className="page-shell review-shell" id="main-content">
      <WorkspaceBackButton goToQueue={goToQueue} />
      <section className="review-heading">
        <div>
          <p className="eyebrow">Final review</p>
          <h1>Confirm relief allocation</h1>
          <p className="lede">
            Review the warehouse, partner, and dispatch outcomes before committing.
          </p>
        </div>
        <div className="review-destination">
          <span>Destination shelter</span>
          <strong>{details.shelter.name}</strong>
          <span>
            {details.targetZone.name} · {formatSeverity(details.targetZone.severity)}
          </span>
        </div>
      </section>

      <div className="review-grid">
        <section className="review-card" aria-labelledby="warehouse-review">
          <p className="section-kicker">Warehouse allocation</p>
          <h2 id="warehouse-review">Allocate now</h2>
          <ul className="review-lines">
            {details.items
              .filter(({ outstandingQty }) => outstandingQty > 0)
              .map((item) => {
                const quantity =
                  command.items.find(({ requestItemId }) => requestItemId === item.requestItemId)
                    ?.allocateQty ?? 0;
                return (
                  <li key={item.requestItemId}>
                    <span>{formatSupplyType(item.supplyType)}</span>
                    <strong>{quantity} units</strong>
                    <small>
                      Stock after confirmation preview:{" "}
                      {item.warehouseStock.availableQty - quantity}
                    </small>
                  </li>
                );
              })}
          </ul>
          {command.items.every(({ allocateQty }) => allocateQty === 0) && (
            <p className="callout callout--neutral">
              Warehouse allocation: 0 units. This command requests partner resupply only.
            </p>
          )}
        </section>

        <section className="review-card" aria-labelledby="resupply-review">
          <p className="section-kicker">Partner resupply</p>
          <h2 id="resupply-review">Remaining shortages</h2>
          {command.shortages.length > 0 ? (
            <ul className="review-lines">
              {command.shortages.map((shortage) => {
                const item = details.items.find(
                  ({ requestItemId }) => requestItemId === shortage.requestItemId,
                );
                if (!item) return null;
                return (
                  <li key={shortage.requestItemId}>
                    <span>{formatSupplyType(item.supplyType)}</span>
                    <strong>{previewShortage(item, draft)} units requested</strong>
                    <small>{partnerName(shortage.partnerOrganisationId)}</small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-inline">No partner resupply is required.</p>
          )}
        </section>

        <section className="review-card" aria-labelledby="dispatch-review">
          <p className="section-kicker">Rescue dispatch</p>
          <h2 id="dispatch-review">Transport support</h2>
          {teamName ? (
            <div className="review-highlight">
              <strong>{teamName}</strong>
              <span>Dispatch to {details.shelter.name} after commit</span>
            </div>
          ) : (
            <p className="empty-inline">No rescue team dispatch selected.</p>
          )}
        </section>

        <section className="review-card" aria-labelledby="outcome-review">
          <p className="section-kicker">Expected outcome</p>
          <h2 id="outcome-review">Request state preview</h2>
          <div className="outcome-status">
            {humanizeConstant(previewRequestStatus(details, command))}
          </div>
          <p className="supporting-text">
            The server recalculates and returns the authoritative state.
          </p>
        </section>
      </div>

      <section className="review-notes">
        <span>Allocation notes</span>
        <p>{command.notes || "No optional notes provided."}</p>
      </section>

      <footer className="confirmation-actions">
        <button className="button button--secondary" onClick={edit} disabled={submitting}>
          Edit allocation
        </button>
        <button
          className="button button--primary button--large"
          onClick={confirm}
          disabled={submitting}
        >
          Confirm allocation
        </button>
      </footer>
    </main>
  );
}

function ReceiptView({
  receipt,
  recovered,
  goToQueue,
  viewUpdatedRequest,
}: {
  readonly receipt: ReliefAllocationReceipt;
  readonly recovered: boolean;
  readonly goToQueue: () => void;
  readonly viewUpdatedRequest: () => void;
}) {
  return (
    <main className="page-shell receipt-shell" id="main-content">
      <section className="receipt-hero" aria-live="polite">
        <span className="success-mark" aria-hidden="true">
          ✓
        </span>
        <p className="eyebrow">Allocation committed</p>
        <h1>Relief allocation finalized</h1>
        <p>
          {recovered
            ? "Existing committed allocation recovered."
            : "Warehouse, resupply, and dispatch records were committed successfully."}
        </p>
      </section>

      <section className="receipt-card" aria-label="Allocation receipt">
        <div className="receipt-card__header">
          <div>
            <span>Allocation reference</span>
            <strong>{receipt.allocationId}</strong>
          </div>
          <span className="status-badge">{humanizeConstant(receipt.requestStatus)}</span>
        </div>
        <dl className="receipt-metadata">
          <div>
            <dt>Committed</dt>
            <dd>{formatDateTime(receipt.createdAt)}</dd>
          </div>
          <div>
            <dt>Request ID</dt>
            <dd>{receipt.requestId}</dd>
          </div>
        </dl>

        <div className="receipt-columns">
          <section>
            <h2>Warehouse items</h2>
            {receipt.items.length > 0 ? (
              <ul className="receipt-list">
                {receipt.items.map((item) => (
                  <li key={item.supplyType}>
                    <span>{formatSupplyType(item.supplyType)}</span>
                    <strong>{item.allocatedQty} units</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-inline">No warehouse stock allocated.</p>
            )}
          </section>
          <section>
            <h2>Partner resupply</h2>
            {receipt.resupplyRequests.length > 0 ? (
              <ul className="receipt-list">
                {receipt.resupplyRequests.map((resupply) => (
                  <li key={resupply.id}>
                    <span>{formatSupplyType(resupply.supplyType)}</span>
                    <strong>{resupply.requestedQty} units</strong>
                    <small>Request …{resupply.id.slice(-8)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-inline">No partner resupply requested.</p>
            )}
          </section>
        </div>

        <section className="dispatch-receipt">
          <div>
            <span>Rescue dispatch</span>
            <strong>{receipt.dispatch ? "Team en route" : "No dispatch"}</strong>
          </div>
          {receipt.dispatch && (
            <span>
              Dispatch …{receipt.dispatch.id.slice(-8)} · Team …{receipt.dispatch.teamId.slice(-8)}
            </span>
          )}
        </section>
      </section>

      <div className="receipt-actions">
        <button className="button button--primary" onClick={goToQueue}>
          Back to relief requests
        </button>
        <button className="button button--secondary" onClick={viewUpdatedRequest}>
          View updated request
        </button>
      </div>
    </main>
  );
}

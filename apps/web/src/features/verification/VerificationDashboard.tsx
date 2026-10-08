import { useEffect, useState } from "react";
import type { PendingReport, ReportReview, VerificationApi } from "./verification-api";

function displayTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

export function VerificationDashboard({ api }: { readonly api: VerificationApi }) {
  const [reports, setReports] = useState<readonly PendingReport[] | null>(null);
  const [queueError, setQueueError] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [review, setReview] = useState<ReportReview | null>(null);
  const [reviewError, setReviewError] = useState(false);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const [evidenceLoaded, setEvidenceLoaded] = useState(false);
  const [evidenceFailed, setEvidenceFailed] = useState(false);
  const [evidenceAttempt, setEvidenceAttempt] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verificationNotes, setVerificationNotes] = useState("");
  const [finalVerificationNotes, setFinalVerificationNotes] = useState<string>();
  const [decisionError, setDecisionError] = useState<string>();
  const [decisionLocked, setDecisionLocked] = useState(false);
  const [conflictReviewError, setConflictReviewError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    reportId: string;
    result: "VERIFIED" | "REJECTED";
    reason: string;
  }>();
  const [success, setSuccess] = useState<string>();
  const [decisionAttempt, setDecisionAttempt] = useState<{
    reportId: string;
    result: "VERIFIED" | "REJECTED";
    reason: string;
    key: string;
  }>();

  const loadQueue = () => {
    setQueueError(false);
    setReports(null);
    void api
      .listPendingReports()
      .then((items) => setReports(items.filter((item) => item.status === "PENDING")))
      .catch(() => setQueueError(true));
  };
  useEffect(loadQueue, [api]);
  useEffect(() => {
    if (!selectedId) return;
    setReview(null);
    setReviewError(false);
    setEvidenceLoaded(false);
    setEvidenceFailed(false);
    void api
      .getReportForReview(selectedId)
      .then((details) => {
        setReview(details);
        if (details.status !== "PENDING") {
          setDecisionLocked(true);
          setConfirmation(undefined);
          setDecisionAttempt(undefined);
        }
      })
      .catch(() => setReviewError(true));
  }, [api, selectedId, reviewAttempt]);

  const requestConfirmation = (result: "VERIFIED" | "REJECTED") => {
    if (!review || review.status !== "PENDING" || decisionLocked || submitting || !evidenceLoaded)
      return;
    const trimmed = (result === "REJECTED" ? reason : verificationNotes).trim();
    if (result === "REJECTED" && (trimmed.length < 10 || trimmed.length > 500)) {
      setDecisionError("A rejection reason must contain 10 to 500 characters.");
      return;
    }
    setDecisionError(undefined);
    setConfirmation({
      reportId: review.id,
      result,
      reason: trimmed,
    });
    if (result === "VERIFIED") setVerifying(false);
  };

  const decide = async () => {
    if (
      !review ||
      review.status !== "PENDING" ||
      decisionLocked ||
      !confirmation ||
      submitting ||
      !evidenceLoaded
    )
      return;
    const { result, reason: trimmed } = confirmation;
    const attemptMatches =
      decisionAttempt?.reportId === review.id &&
      decisionAttempt.result === result &&
      decisionAttempt.reason === trimmed;
    const idempotencyKey = attemptMatches ? decisionAttempt.key : crypto.randomUUID();
    setDecisionAttempt({
      reportId: review.id,
      result,
      reason: trimmed,
      key: idempotencyKey,
    });
    setSubmitting(true);
    setDecisionError(undefined);
    try {
      const decision = await api.decideReport(
        review.id,
        result === "REJECTED" || trimmed ? { result, reason: trimmed } : { result },
        idempotencyKey,
      );
      setSuccess(`Report ${result.toLowerCase()} successfully.`);
      setReview({ ...review, status: result });
      if (result === "VERIFIED") {
        const savedReason =
          typeof decision === "object" && decision !== null && "reason" in decision
            ? (decision as { reason?: unknown }).reason
            : undefined;
        setFinalVerificationNotes(
          typeof savedReason === "string" ? savedReason.trim() || undefined : undefined,
        );
      }
      setDecisionLocked(true);
      setConfirmation(undefined);
      setRejecting(false);
      setReason("");
      setVerificationNotes("");
      setVerifying(false);
      setDecisionAttempt(undefined);
      loadQueue();
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status: number }).status
          : 0;
      if (status === 409) {
        setDecisionError("This report has already been processed.");
        setDecisionLocked(true);
        setConflictReviewError(false);
        setReview(null);
        setConfirmation(undefined);
        loadQueue();
        setDecisionAttempt(undefined);
        void api
          .getReportForReview(review.id)
          .then((details) => {
            setReview(details);
            if (details.status !== "PENDING") {
              setDecisionLocked(true);
              setConfirmation(undefined);
            }
          })
          .catch(() => setConflictReviewError(true));
      } else setDecisionError("Unable to submit the decision. Please retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const [escalationAttempt, setEscalationAttempt] = useState<{
    reportId: string;
    key: string;
  }>();
  const [escalationSubmitting, setEscalationSubmitting] = useState(false);
  const [escalationError, setEscalationError] = useState<string>();
  const [escalationResult, setEscalationResult] = useState<{
    reportId: string;
    httpStatus: 200 | 201;
    draft: {
      alertId: string;
      sourceReportId: string;
      status: "DRAFT";
      version: number;
    };
  }>();

  const escalate = async () => {
    if (review?.status !== "VERIFIED" || escalationSubmitting || escalationResult) return;
    const key =
      escalationAttempt?.reportId === review.id ? escalationAttempt.key : crypto.randomUUID();
    setEscalationAttempt({ reportId: review.id, key });
    setEscalationSubmitting(true);
    setEscalationError(undefined);
    try {
      const result = await api.escalateVerifiedReport(review.id, key);
      setEscalationResult({ reportId: review.id, ...result });
      setEscalationAttempt(undefined);
    } catch (error) {
      setEscalationError("Unable to prepare the DRAFT alert. Please retry safely.");
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status: number }).status
          : 0;
      if (status === 409) {
        setReview(null);
        setConflictReviewError(false);
        setDecisionLocked(true);
        loadQueue();
        void api
          .getReportForReview(review.id)
          .then((details) => {
            setReview(details);
            setDecisionLocked(details.status !== "PENDING");
          })
          .catch(() => setConflictReviewError(true));
      }
    } finally {
      setEscalationSubmitting(false);
    }
  };

  return (
    <section className="verification-workspace" aria-label="Hazard verification dashboard">
      <header className="verification-page-header">
        <div>
          <div className="section-kicker">DMC duty officer</div>
          <h2>Verify Hazard Reports</h2>
          <p>Review citizen hazard reports and make a verified or rejected decision.</p>
        </div>
      </header>
      <div className="verification-dashboard">
        <aside className="pending-queue" aria-labelledby="pending-queue-title">
          <div className="panel-heading">
            <div>
              <div className="section-kicker">Review queue</div>
              <h3 id="pending-queue-title">Pending reports</h3>
            </div>
            {reports !== null && <span className="queue-count">{reports.length}</span>}
          </div>
          {reports === null && !queueError && <p role="status">Loading pending reports…</p>}
          {queueError && (
            <div role="alert">
              <p>Unable to load pending reports.</p>
              <button onClick={loadQueue}>Retry queue</button>
            </div>
          )}
          {reports?.length === 0 && <p>No reports are awaiting officer review.</p>}
          <ul>
            {reports?.map((report) => (
              <li key={report.id}>
                <button
                  className={selectedId === report.id ? "selected" : ""}
                  aria-pressed={selectedId === report.id}
                  disabled={escalationSubmitting}
                  onClick={() => {
                    if (selectedId === report.id) return;
                    setDecisionAttempt(undefined);
                    setConfirmation(undefined);
                    setDecisionLocked(false);
                    setConflictReviewError(false);
                    setEscalationAttempt(undefined);
                    setEscalationResult(undefined);
                    setEscalationError(undefined);
                    setRejecting(false);
                    setReason("");
                    setVerifying(false);
                    setVerificationNotes("");
                    setFinalVerificationNotes(undefined);
                    setDecisionError(undefined);
                    setEvidenceLoaded(false);
                    setEvidenceFailed(false);
                    setSelectedId(report.id);
                  }}
                >
                  <span className="queue-card-heading">
                    <strong>{report.hazardType}</strong>
                    <span className="status-badge status-badge--pending">Pending</span>
                  </span>
                  <span className="queue-report-id">Report · {report.id.slice(0, 8)}…</span>
                  <span className="queue-submitted">
                    Submitted {displayTime(report.submittedAt)}
                  </span>
                  {report.requiresExtraReview && <em>Advisory review</em>}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <article className="report-review" aria-labelledby="report-review-title">
          <header className="review-header">
            <div>
              <div className="section-kicker">Selected report</div>
              <h3 id="report-review-title">
                {review?.hazardType ?? (selectedId ? "Loading report" : "Report review")}
              </h3>
              {review && <p className="review-report-id">Report ID · {review.id}</p>}
            </div>
            {review && (
              <span className={`status-badge status-badge--${review.status.toLowerCase()}`}>
                {review.status}
              </span>
            )}
          </header>
          {review?.status === "PENDING" && (
            <p className="review-prompt">Awaiting officer decision</p>
          )}
          {success && <p role="status">{success}</p>}
          {decisionError && <p role="alert">{decisionError}</p>}
          {escalationError && <p role="alert">{escalationError}</p>}
          {conflictReviewError && (
            <p role="status">The current report status could not be loaded.</p>
          )}
          {!selectedId && <p>Select a pending report to review its evidence.</p>}
          {selectedId && !review && !reviewError && !conflictReviewError && (
            <p role="status">Loading report details…</p>
          )}
          {reviewError && (
            <div role="alert">
              <p>Report details are unavailable.</p>
              <button onClick={() => setSelectedId(undefined)}>Choose another report</button>
              <button onClick={() => setReviewAttempt((attempt) => attempt + 1)}>
                Retry review
              </button>
            </div>
          )}
          {review && (
            <>
              {review.status !== "PENDING" && (
                <p
                  className={`final-state final-state--${review.status.toLowerCase()}`}
                  role="status"
                >
                  This report has already been processed. Final status: {review.status}.
                </p>
              )}
              {review.status === "VERIFIED" && finalVerificationNotes && (
                <p>Verification notes: {finalVerificationNotes}</p>
              )}
              {review.status === "VERIFIED" && (
                <section aria-label="Draft alert escalation">
                  <p>
                    Prepare a DRAFT alert for the broadcast workflow. This will not activate or
                    broadcast the alert.
                  </p>
                  {escalationSubmitting && <p role="status">Preparing DRAFT alert…</p>}
                  {!escalationResult && (
                    <button disabled={escalationSubmitting} onClick={() => void escalate()}>
                      Escalate to Warning
                    </button>
                  )}
                  {escalationResult?.reportId === review.id && (
                    <div role="status">
                      <p>
                        {escalationResult.httpStatus === 201
                          ? "A new DRAFT alert was prepared."
                          : "An existing DRAFT alert was returned."}
                      </p>
                      <dl>
                        <dt>Alert ID</dt>
                        <dd>{escalationResult.draft.alertId}</dd>
                        <dt>Source report ID</dt>
                        <dd>{escalationResult.draft.sourceReportId}</dd>
                        <dt>Status</dt>
                        <dd>{escalationResult.draft.status}</dd>
                        <dt>Version</dt>
                        <dd>{escalationResult.draft.version}</dd>
                      </dl>
                    </div>
                  )}
                </section>
              )}
              {review.requiresExtraReview && (
                <p className="advisory">
                  Advisory only: this report requires extra review. The officer remains responsible
                  for the decision.
                </p>
              )}
              <div className="report-sections">
                <section className="detail-card" aria-labelledby="report-details-title">
                  <h4 id="report-details-title">Report details</h4>
                  <dl className="detail-grid">
                    <div>
                      <dt>Submitted</dt>
                      <dd>{displayTime(review.submittedAt)}</dd>
                    </div>
                    <div>
                      <dt>District ID</dt>
                      <dd>{review.location.districtId}</dd>
                    </div>
                    <div>
                      <dt>Location source</dt>
                      <dd>{review.location.source}</dd>
                    </div>
                  </dl>
                </section>
                <section className="detail-card" aria-labelledby="location-title">
                  <h4 id="location-title">Location</h4>
                  <dl className="detail-grid">
                    <div>
                      <dt>Coordinates</dt>
                      <dd>
                        {review.location.latitude}, {review.location.longitude}
                      </dd>
                    </div>
                    <div className="detail-grid-wide">
                      <dt>Address</dt>
                      <dd>{review.location.address ?? "No address provided"}</dd>
                    </div>
                  </dl>
                </section>
                <section className="detail-card" aria-labelledby="description-title">
                  <h4 id="description-title">Description</h4>
                  <p>{review.description}</p>
                </section>
                <section className="detail-card evidence-card" aria-labelledby="evidence-title">
                  <h4 id="evidence-title">Evidence photo</h4>
                  <div
                    className={`evidence-frame${evidenceFailed ? " evidence-frame--failed" : ""}`}
                  >
                    {!evidenceFailed && (
                      <img
                        key={`${review.photoRef}-${evidenceAttempt}`}
                        src={review.photoRef}
                        alt={`Submitted evidence for ${review.hazardType}`}
                        onLoad={() => {
                          setEvidenceLoaded(true);
                          setEvidenceFailed(false);
                        }}
                        onError={() => {
                          setEvidenceLoaded(false);
                          setEvidenceFailed(true);
                          setConfirmation(undefined);
                          setVerifying(false);
                        }}
                      />
                    )}
                    {evidenceFailed && (
                      <div role="alert" className="evidence-error">
                        <strong>Evidence photo is unavailable</strong>
                        <span>The report remains PENDING. Decision actions are disabled.</span>
                        <button
                          onClick={() => {
                            setEvidenceLoaded(false);
                            setEvidenceFailed(false);
                            setEvidenceAttempt((attempt) => attempt + 1);
                          }}
                        >
                          Retry evidence
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
              {review.status === "PENDING" && !decisionLocked && (
                <section aria-label="Decision actions">
                  <button
                    disabled={submitting || !evidenceLoaded}
                    onClick={() => {
                      setRejecting(false);
                      setVerifying(true);
                    }}
                  >
                    Verify
                  </button>
                  <button
                    disabled={submitting || !evidenceLoaded}
                    onClick={() => {
                      setVerifying(false);
                      setRejecting(true);
                    }}
                  >
                    Reject
                  </button>
                  {verifying && (
                    <>
                      <label>
                        Optional verification notes
                        <textarea
                          value={verificationNotes}
                          onChange={(event) => setVerificationNotes(event.target.value)}
                        />
                      </label>
                      <button
                        disabled={submitting || !evidenceLoaded}
                        onClick={() => requestConfirmation("VERIFIED")}
                      >
                        Continue to confirmation
                      </button>
                      <button disabled={submitting} onClick={() => setVerifying(false)}>
                        Cancel verification
                      </button>
                    </>
                  )}
                  {rejecting && (
                    <>
                      <label>
                        Rejection reason
                        <textarea
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                      <button
                        disabled={submitting || !evidenceLoaded}
                        onClick={() => requestConfirmation("REJECTED")}
                      >
                        Continue to confirmation
                      </button>
                    </>
                  )}
                  {submitting && <p role="status">Submitting decision…</p>}
                </section>
              )}
            </>
          )}
        </article>
      </div>
      {confirmation && review && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="decision-confirmation-title"
          className="decision-confirmation"
        >
          <h2 id="decision-confirmation-title">Confirm report decision</h2>
          <p>Report ID: {confirmation.reportId}</p>
          <p>Chosen result: {confirmation.result}</p>
          {confirmation.result === "REJECTED" && <p>Rejection reason: {confirmation.reason}</p>}
          {confirmation.result === "VERIFIED" && confirmation.reason && (
            <p>Verification notes: {confirmation.reason}</p>
          )}
          <button disabled={submitting || !evidenceLoaded} onClick={() => void decide()}>
            Confirm decision
          </button>
          <button disabled={submitting} onClick={() => setConfirmation(undefined)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

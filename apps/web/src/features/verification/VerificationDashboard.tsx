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
  const [evidenceFailed, setEvidenceFailed] = useState(false);
  const [evidenceAttempt, setEvidenceAttempt] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [decisionError, setDecisionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
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
    setEvidenceFailed(false);
    void api
      .getReportForReview(selectedId)
      .then(setReview)
      .catch(() => setReviewError(true));
  }, [api, selectedId]);

  const decide = async (result: "VERIFIED" | "REJECTED") => {
    if (!review || submitting) return;
    const trimmed = reason.trim();
    if (result === "REJECTED" && (trimmed.length < 10 || trimmed.length > 500)) {
      setDecisionError("A rejection reason must contain 10 to 500 characters.");
      return;
    }
    const attemptMatches =
      decisionAttempt?.reportId === review.id &&
      decisionAttempt.result === result &&
      decisionAttempt.reason === (result === "REJECTED" ? trimmed : "");
    const idempotencyKey = attemptMatches ? decisionAttempt.key : crypto.randomUUID();
    setDecisionAttempt({
      reportId: review.id,
      result,
      reason: result === "REJECTED" ? trimmed : "",
      key: idempotencyKey,
    });
    setSubmitting(true);
    setDecisionError(undefined);
    try {
      await api.decideReport(
        review.id,
        result === "REJECTED" ? { result, reason: trimmed } : { result },
        idempotencyKey,
      );
      setSuccess(`Report ${result.toLowerCase()} successfully.`);
      setSelectedId(undefined);
      setReview(null);
      setRejecting(false);
      setReason("");
      setDecisionAttempt(undefined);
      loadQueue();
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status: number }).status
          : 0;
      if (status === 409) {
        setDecisionError("This report has already been processed.");
        setSelectedId(undefined);
        setReview(null);
        loadQueue();
        setDecisionAttempt(undefined);
      } else setDecisionError("Unable to submit the decision. Please retry.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="verification-dashboard" aria-label="Hazard verification dashboard">
      <aside className="pending-queue">
        <div className="section-kicker">DMC duty officer</div>
        <h2>Pending hazard reports</h2>
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
                onClick={() => {
                  if (selectedId !== report.id) {
                    setDecisionAttempt(undefined);
                    setRejecting(false);
                    setReason("");
                    setDecisionError(undefined);
                  }
                  setSelectedId(report.id);
                }}
              >
                <strong>{report.hazardType}</strong>
                <span>{displayTime(report.submittedAt)}</span>
                {report.requiresExtraReview && <em>Advisory: extra review</em>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <article className="report-review">
        <div className="section-kicker">Report review</div>
        <h2>Awaiting officer decision</h2>
        {success && <p role="status">{success}</p>}
        {decisionError && <p role="alert">{decisionError}</p>}
        {!selectedId && <p>Select a pending report to review its evidence.</p>}
        {selectedId && !review && !reviewError && <p role="status">Loading report details…</p>}
        {reviewError && (
          <div role="alert">
            <p>Report details are unavailable.</p>
            <button onClick={() => setSelectedId(undefined)}>Choose another report</button>
            <button onClick={() => setSelectedId(selectedId)}>Retry review</button>
          </div>
        )}
        {review && (
          <>
            <p className="status">{review.status}</p>
            <h3>{review.hazardType}</h3>
            {review.requiresExtraReview && (
              <p className="advisory">
                Advisory only: this report requires extra review. The officer remains responsible
                for the decision.
              </p>
            )}
            <dl>
              <dt>Submitted</dt>
              <dd>{displayTime(review.submittedAt)}</dd>
              <dt>District</dt>
              <dd>{review.location.districtId}</dd>
              <dt>Location source</dt>
              <dd>{review.location.source}</dd>
              <dt>GPS</dt>
              <dd>
                {review.location.latitude}, {review.location.longitude}
              </dd>
              <dt>Address</dt>
              <dd>{review.location.address ?? "No address provided"}</dd>
            </dl>
            <h3>Description</h3>
            <p>{review.description}</p>
            <h3>Evidence photo</h3>
            <img
              key={`${review.photoRef}-${evidenceAttempt}`}
              src={review.photoRef}
              alt={`Submitted evidence for ${review.hazardType}`}
              hidden={evidenceFailed}
              onError={() => setEvidenceFailed(true)}
            />
            {evidenceFailed && (
              <p role="alert">
                Evidence photo is unavailable. The report remains pending.{" "}
                <button
                  onClick={() => {
                    setEvidenceFailed(false);
                    setEvidenceAttempt((attempt) => attempt + 1);
                  }}
                >
                  Retry evidence
                </button>
              </p>
            )}
            <section aria-label="Decision actions">
              <button disabled={submitting} onClick={() => void decide("VERIFIED")}>
                Verify
              </button>
              <button disabled={submitting} onClick={() => setRejecting(true)}>
                Reject
              </button>
              {rejecting && (
                <>
                  <label>
                    Rejection reason
                    <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
                  </label>
                  <button disabled={submitting} onClick={() => void decide("REJECTED")}>
                    Confirm rejection
                  </button>
                </>
              )}
              {submitting && <p role="status">Submitting decision…</p>}
            </section>
          </>
        )}
      </article>
    </section>
  );
}

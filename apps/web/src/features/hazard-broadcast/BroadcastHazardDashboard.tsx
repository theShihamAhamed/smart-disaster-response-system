import { useEffect, useState } from "react";
import type {
  AlertPreviewInfo,
  AlertSummaryItem,
  BroadcastApi,
  DeliveryItem,
  DeliverySummary,
  TargetZoneOption,
} from "./broadcast-api";

const INITIAL_TARGET_ZONES: readonly TargetZoneOption[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    code: "KLN-01",
    name: "Colombo Critical Flood Zone",
    districtName: "Colombo",
    populationEstimate: 45000,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    code: "KLN-02",
    name: "Colombo High Zone",
    districtName: "Colombo",
    populationEstimate: 38000,
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    code: "KG-01",
    name: "Kalu Ganga Basin",
    districtName: "Kalutara",
    populationEstimate: 29000,
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    code: "RTN-01",
    name: "Ratnapura Flood Plain",
    districtName: "Ratnapura",
    populationEstimate: 32000,
  },
];

const INITIAL_ALERTS: readonly AlertSummaryItem[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    sourceReportId: "40000000-0000-4000-8000-000000000002",
    hazardType: "FLOOD",
    severity: "WARNING",
    message: "Water levels rising rapidly in the Kelani River basin. Low-lying areas at risk.",
    safetyInstructions: "Move valuables to upper floors. Follow local evacuation guidance.",
    status: "DRAFT",
    version: 1,
    parentAlertId: null,
    targetZoneIds: ["30000000-0000-4000-8000-000000000001"],
    issuedAt: null,
    cancelledAt: null,
    cancellationReason: null,
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    sourceReportId: "40000000-0000-4000-8000-000000000004",
    hazardType: "FLOOD",
    severity: "WARNING",
    message: "Major flood warning active across downstream Kelani River basin.",
    safetyInstructions: "Stay away from riverbanks. Evacuate immediately if instructed.",
    status: "ACTIVE",
    version: 1,
    parentAlertId: null,
    targetZoneIds: ["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"],
    issuedAt: "2026-09-25T10:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
  },
  {
    id: "50000000-0000-4000-8000-000000000003",
    sourceReportId: "40000000-0000-4000-8000-000000000003",
    hazardType: "FLOOD",
    severity: "ADVISORY",
    message: "Initial minor flood advisory for Kalu Ganga basin.",
    safetyInstructions: "Monitor water levels and local news announcements.",
    status: "SUPERSEDED",
    version: 1,
    parentAlertId: null,
    targetZoneIds: ["30000000-0000-4000-8000-000000000003"],
    issuedAt: "2026-09-24T14:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
  },
  {
    id: "50000000-0000-4000-8000-000000000004",
    sourceReportId: "40000000-0000-4000-8000-000000000001",
    hazardType: "CYCLONE",
    severity: "WARNING",
    message: "Strong gale force winds along coastal areas.",
    safetyInstructions: "Stay indoors away from exposed windows.",
    status: "CANCELLED",
    version: 1,
    parentAlertId: null,
    targetZoneIds: ["30000000-0000-4000-8000-000000000001"],
    issuedAt: "2026-09-23T06:00:00.000Z",
    cancelledAt: "2026-09-23T18:00:00.000Z",
    cancellationReason: "Cyclone moved offshore. All clear declared by meteorological department.",
  },
];

function displayTime(value: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    if ("body" in error && (error as any).body?.error?.message) {
      const code = (error as any).body?.error?.code;
      const msg = (error as any).body.error.message;
      if (code === "REPORT_NOT_VERIFIED") {
        return "This hazard report is not verified and cannot create an alert draft.";
      }
      if (code === "ALERT_NOT_IN_DRAFT") {
        return "This alert is no longer a draft and cannot be edited or broadcast.";
      }
      if (code === "SIMILAR_ALERT_ACTIVE") {
        return "A similar active alert already exists. Review active alerts before broadcasting.";
      }
      if (code === "ALERT_NOT_ACTIVE") {
        return "This alert is no longer active.";
      }
      if (code === "ALERT_ALREADY_ACTIVE") {
        return "The alert is already active and cannot be broadcast again.";
      }
      if (code === "FORBIDDEN") {
        return "You do not have permission to broadcast alerts.";
      }
      return msg;
    }
    if ("message" in error && typeof (error as any).message === "string") {
      return (error as any).message;
    }
  }
  return fallback;
}

export function BroadcastHazardDashboard({ api }: { readonly api?: BroadcastApi | undefined }) {
  const [alerts, setAlerts] = useState<readonly AlertSummaryItem[]>(INITIAL_ALERTS);
  const [selectedAlertId, setSelectedAlertId] = useState<string>(INITIAL_ALERTS[0]!.id);
  const [activeTab, setActiveTab] = useState<"ALL" | "DRAFTS" | "ACTIVE">("ALL");

  // Form state
  const fallbackAlert: AlertSummaryItem = INITIAL_ALERTS[0]!;
  const selectedAlert: AlertSummaryItem =
    alerts.find((a) => a.id === selectedAlertId) ?? alerts[0] ?? fallbackAlert;

  const [severity, setSeverity] = useState<"ADVISORY" | "WARNING" | "EVACUATION">(
    (selectedAlert.severity as any) ?? "WARNING",
  );
  const [message, setMessage] = useState(selectedAlert.message);
  const [safetyInstructions, setSafetyInstructions] = useState(selectedAlert.safetyInstructions);
  const [selectedZoneIds, setSelectedZoneIds] = useState<readonly string[]>(
    selectedAlert.targetZoneIds,
  );

  // View modes within workspace
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirmingSend, setIsConfirmingSend] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Loading, Validation & Feedback
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();

  // Delivery tracking store
  const [deliveryData, setDeliveryData] = useState<
    Record<string, { summary: DeliverySummary; deliveries: readonly DeliveryItem[] }>
  >({});

  // Server preview state
  const [serverPreview, setServerPreview] = useState<AlertPreviewInfo | null>(null);
  const [serverSimilarActive, setServerSimilarActive] = useState<readonly AlertSummaryItem[]>([]);

  // Idempotency tracking
  const [broadcastAttempt, setBroadcastAttempt] = useState<{ alertId: string; key: string }>();
  const [cancelAttempt, setCancelAttempt] = useState<{
    alertId: string;
    reason: string;
    key: string;
  }>();

  // Load deliveries when active alert selected
  useEffect(() => {
    if (!api || selectedAlert.status !== "ACTIVE") return;

    void api
      .getDeliveries(selectedAlert.id)
      .then((res) => {
        setDeliveryData((prev) => ({
          ...prev,
          [selectedAlert.id]: {
            summary: {
              total: res.total,
              pending: res.pending,
              pushSent: res.pushSent,
              pushFailed: res.pushFailed,
              smsFallbackQueued: res.smsFallbackQueued,
              smsSent: res.smsSent,
              failedFinal: res.failedFinal,
            },
            deliveries: res.deliveries,
          },
        }));
      })
      .catch(() => {
        // Delivery tracking load error ignored gracefully
      });
  }, [api, selectedAlert.id, selectedAlert.status]);

  const selectAlert = (alert: AlertSummaryItem) => {
    setSelectedAlertId(alert.id);
    setSeverity(alert.severity as any);
    setMessage(alert.message);
    setSafetyInstructions(alert.safetyInstructions);
    setSelectedZoneIds(alert.targetZoneIds);
    setIsPreviewing(false);
    setIsConfirmingSend(false);
    setIsCancelling(false);
    setValidationError(undefined);
    setErrorMessage(undefined);
    setStatusMessage(undefined);
    setServerPreview(null);
    setServerSimilarActive([]);
  };

  const toggleZone = (zoneId: string) => {
    if (selectedZoneIds.includes(zoneId)) {
      setSelectedZoneIds(selectedZoneIds.filter((id) => id !== zoneId));
    } else {
      setSelectedZoneIds([...selectedZoneIds, zoneId]);
    }
  };

  const calculateEstimate = (zoneIds: readonly string[]) => {
    return INITIAL_TARGET_ZONES.filter((z) => zoneIds.includes(z.id)).reduce(
      (sum, z) => sum + (z.populationEstimate ?? 0),
      0,
    );
  };

  const handleSaveDraft = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setValidationError("Alert message cannot be blank.");
      return;
    }
    const trimmedInstructions = safetyInstructions.trim();
    if (!trimmedInstructions) {
      setValidationError("Safety instructions cannot be blank.");
      return;
    }
    if (selectedZoneIds.length === 0) {
      setValidationError("At least one target zone must be selected.");
      return;
    }

    setValidationError(undefined);
    setErrorMessage(undefined);

    if (api) {
      setIsLoading("Saving draft...");
      try {
        const updated = await api.updateDraft(selectedAlertId, {
          severity,
          message: trimmedMessage,
          safetyInstructions: trimmedInstructions,
          targetZoneIds: selectedZoneIds,
        });

        setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        setStatusMessage("Draft alert saved successfully.");
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, "Unable to save draft alert."));
      } finally {
        setIsLoading(null);
      }
    } else {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === selectedAlertId
            ? {
                ...a,
                severity,
                message: trimmedMessage,
                safetyInstructions: trimmedInstructions,
                targetZoneIds: selectedZoneIds,
              }
            : a,
        ),
      );
      setStatusMessage("Draft alert saved successfully.");
    }
  };

  const handlePreview = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setValidationError("Alert message cannot be blank.");
      return;
    }
    const trimmedInstructions = safetyInstructions.trim();
    if (!trimmedInstructions) {
      setValidationError("Safety instructions cannot be blank.");
      return;
    }
    if (selectedZoneIds.length === 0) {
      setValidationError("At least one target zone must be selected.");
      return;
    }

    setValidationError(undefined);
    setErrorMessage(undefined);

    if (api) {
      setIsLoading("Loading preview...");
      try {
        const preview = await api.getPreview(selectedAlertId);
        const similar = await api.getSimilarActive(selectedAlertId);
        setServerPreview(preview);
        setServerSimilarActive(similar);
        setIsPreviewing(true);
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, "Unable to load alert preview."));
      } finally {
        setIsLoading(null);
      }
    } else {
      setIsPreviewing(true);
    }
  };

  const handleConfirmBroadcast = async () => {
    setErrorMessage(undefined);
    const idempotencyKey =
      broadcastAttempt?.alertId === selectedAlertId ? broadcastAttempt.key : crypto.randomUUID();
    setBroadcastAttempt({ alertId: selectedAlertId, key: idempotencyKey });

    if (api) {
      setIsLoading("Broadcasting alert...");
      try {
        const result = await api.broadcastAlert(selectedAlertId, idempotencyKey);
        setAlerts((prev) => prev.map((a) => (a.id === result.alert.id ? result.alert : a)));
        setDeliveryData((prev) => ({
          ...prev,
          [result.alert.id]: {
            summary: {
              total: result.deliveries.length,
              pending: result.deliveries.filter((d) => d.status === "PENDING").length,
              pushSent: result.deliveries.filter((d) => d.status === "PUSH_SENT").length,
              pushFailed: result.deliveries.filter((d) => d.status === "PUSH_FAILED").length,
              smsFallbackQueued: result.deliveries.filter((d) => d.status === "SMS_FALLBACK_QUEUED")
                .length,
              smsSent: result.deliveries.filter((d) => d.status === "SMS_SENT").length,
              failedFinal: result.deliveries.filter((d) => d.status === "FAILED_FINAL").length,
            },
            deliveries: result.deliveries,
          },
        }));
        setIsPreviewing(false);
        setIsConfirmingSend(false);
        setStatusMessage("Alert broadcast successfully! Active hazard broadcast is now live.");
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, "Unable to broadcast alert."));
      } finally {
        setIsLoading(null);
      }
    } else {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === selectedAlertId
            ? {
                ...a,
                severity,
                message: message.trim(),
                safetyInstructions: safetyInstructions.trim(),
                targetZoneIds: selectedZoneIds,
                status: "ACTIVE",
                issuedAt: new Date().toISOString(),
              }
            : a,
        ),
      );
      setIsPreviewing(false);
      setIsConfirmingSend(false);
      setStatusMessage("Alert broadcast successfully! Active hazard broadcast is now live.");
    }
  };

  const handleCreateReplacement = async () => {
    setErrorMessage(undefined);
    if (api) {
      setIsLoading("Creating replacement draft...");
      try {
        const replacement = await api.createReplacementDraft(selectedAlert.id);
        setAlerts((prev) => [replacement, ...prev]);
        selectAlert(replacement);
        setStatusMessage(
          `Created Replacement Draft (Version ${replacement.version}) replacing Version ${selectedAlert.version}.`,
        );
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, "Unable to create replacement draft."));
      } finally {
        setIsLoading(null);
      }
    } else {
      const newId = `alert-mock-${Date.now()}`;
      const replacement: AlertSummaryItem = {
        id: newId,
        sourceReportId: selectedAlert.sourceReportId,
        hazardType: selectedAlert.hazardType,
        severity: selectedAlert.severity,
        message: selectedAlert.message,
        safetyInstructions: selectedAlert.safetyInstructions,
        status: "DRAFT",
        version: selectedAlert.version + 1,
        parentAlertId: selectedAlert.id,
        targetZoneIds: [...selectedAlert.targetZoneIds],
        issuedAt: null,
        cancelledAt: null,
        cancellationReason: null,
      };

      setAlerts((prev) => [replacement, ...prev]);
      selectAlert(replacement);
      setStatusMessage(
        `Created Replacement Draft (Version ${replacement.version}) replacing Version ${selectedAlert.version}.`,
      );
    }
  };

  const handleCancelAlert = async () => {
    const trimmed = cancelReason.trim();
    if (trimmed.length < 10) {
      setValidationError("Cancellation reason must be at least 10 characters.");
      return;
    }
    if (trimmed.length > 500) {
      setValidationError("Cancellation reason cannot exceed 500 characters.");
      return;
    }

    setValidationError(undefined);
    setErrorMessage(undefined);
    const idempotencyKey =
      cancelAttempt?.alertId === selectedAlertId && cancelAttempt.reason === trimmed
        ? cancelAttempt.key
        : crypto.randomUUID();
    setCancelAttempt({ alertId: selectedAlertId, reason: trimmed, key: idempotencyKey });

    if (api) {
      setIsLoading("Cancelling alert...");
      try {
        const cancelled = await api.cancelAlert(selectedAlert.id, trimmed, idempotencyKey);
        setAlerts((prev) => prev.map((a) => (a.id === cancelled.id ? cancelled : a)));
        setIsCancelling(false);
        setCancelReason("");
        setStatusMessage("Alert cancelled and All Clear notification dispatched successfully.");
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, "Unable to cancel alert."));
      } finally {
        setIsLoading(null);
      }
    } else {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === selectedAlertId
            ? {
                ...a,
                status: "CANCELLED",
                cancelledAt: new Date().toISOString(),
                cancellationReason: trimmed,
              }
            : a,
        ),
      );
      setIsCancelling(false);
      setCancelReason("");
      setStatusMessage("Alert cancelled and All Clear notification dispatched successfully.");
    }
  };

  const handleRetryDeliveries = async () => {
    setErrorMessage(undefined);
    if (api) {
      setIsLoading("Retrying failed deliveries...");
      try {
        await api.retryDeliveries(selectedAlertId);
        const refreshed = await api.getDeliveries(selectedAlertId);
        setDeliveryData((prev) => ({
          ...prev,
          [selectedAlertId]: {
            summary: {
              total: refreshed.total,
              pending: refreshed.pending,
              pushSent: refreshed.pushSent,
              pushFailed: refreshed.pushFailed,
              smsFallbackQueued: refreshed.smsFallbackQueued,
              smsSent: refreshed.smsSent,
              failedFinal: refreshed.failedFinal,
            },
            deliveries: refreshed.deliveries,
          },
        }));
        setStatusMessage("Delivery retry triggered. Failed recipients processed.");
      } catch (error) {
        setErrorMessage(extractErrorMessage(error, "Unable to retry deliveries."));
      } finally {
        setIsLoading(null);
      }
    } else {
      const current = deliveryData[selectedAlertId];
      if (!current) return;

      setDeliveryData((prev) => ({
        ...prev,
        [selectedAlertId]: {
          ...current,
          summary: {
            ...current.summary,
            pushFailed: 0,
            smsSent: current.summary.smsSent + current.summary.failedFinal,
            failedFinal: 0,
          },
          deliveries: current.deliveries.map((d) =>
            d.status === "FAILED_FINAL"
              ? {
                  ...d,
                  status: "SMS_SENT",
                  attemptNo: d.attemptNo + 1,
                  lastFailureReason: "Retried and succeeded via secondary SMS gateway",
                  updatedAt: new Date().toISOString(),
                }
              : d,
          ),
        },
      }));
      setStatusMessage("Delivery retry triggered. Failed recipients processed.");
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (activeTab === "DRAFTS") return a.status === "DRAFT";
    if (activeTab === "ACTIVE") return a.status === "ACTIVE";
    return true;
  });

  const estimatedReach = serverPreview?.estimatedRecipients ?? calculateEstimate(selectedZoneIds);
  const currentDeliveries = deliveryData[selectedAlertId];

  // Conflict check for preview (use server results if available, else local search)
  const similarActiveAlerts =
    serverSimilarActive.length > 0
      ? serverSimilarActive
      : alerts.filter(
          (a) =>
            a.id !== selectedAlert.id &&
            a.id !== selectedAlert.parentAlertId &&
            a.status === "ACTIVE" &&
            a.hazardType === selectedAlert.hazardType &&
            a.targetZoneIds.some((id) => selectedZoneIds.includes(id)),
        );

  return (
    <section className="broadcast-dashboard" aria-label="Broadcast Hazard Alert Dashboard">
      {/* LEFT SIDEBAR: ALERTS & DRAFTS QUEUE */}
      <aside className="alert-queue">
        <div className="section-kicker">DMC Duty Officer</div>
        <h2>Hazard Broadcast Queue</h2>

        <div className="filter-tabs" role="tablist" aria-label="Filter alerts">
          <button
            role="tab"
            aria-selected={activeTab === "ALL"}
            className={activeTab === "ALL" ? "selected" : ""}
            onClick={() => setActiveTab("ALL")}
          >
            All ({alerts.length})
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "ACTIVE"}
            className={activeTab === "ACTIVE" ? "selected" : ""}
            onClick={() => setActiveTab("ACTIVE")}
          >
            Active ({alerts.filter((a) => a.status === "ACTIVE").length})
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "DRAFTS"}
            className={activeTab === "DRAFTS" ? "selected" : ""}
            onClick={() => setActiveTab("DRAFTS")}
          >
            Drafts ({alerts.filter((a) => a.status === "DRAFT").length})
          </button>
        </div>

        <ul className="alert-list">
          {filteredAlerts.map((alert) => (
            <li key={alert.id}>
              <button
                className={`alert-card ${selectedAlertId === alert.id ? "selected" : ""}`}
                onClick={() => selectAlert(alert)}
                aria-label={`Select alert ${alert.hazardType} Version ${alert.version} (${alert.status})`}
              >
                <div className="card-header">
                  <strong>{alert.hazardType}</strong>
                  <span className={`status-badge status-${alert.status.toLowerCase()}`}>
                    {alert.status}
                  </span>
                </div>
                <div className="card-meta">
                  <span>Severity: {alert.severity}</span>
                  <span>v{alert.version}</span>
                </div>
                <div className="card-zones">
                  <span>{alert.targetZoneIds.length} Target Zone(s)</span>
                  <small>{displayTime(alert.issuedAt ?? alert.cancelledAt)}</small>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* RIGHT MAIN PANEL: ALERT OPERATIONS WORKSPACE */}
      <article className="alert-workspace">
        <div className="section-kicker">Broadcast Management</div>
        <h2>
          {selectedAlert.hazardType} Alert — v{selectedAlert.version} ({selectedAlert.status})
        </h2>

        {selectedAlert.parentAlertId && (
          <div className="version-banner" role="note">
            <span>
              Replacement Update: <strong>Version {selectedAlert.version}</strong> (replaces parent
              alert <code>{selectedAlert.parentAlertId}</code>)
            </span>
          </div>
        )}

        {isLoading && (
          <p className="status-message loading-state" role="status">
            {isLoading}
          </p>
        )}
        {statusMessage && (
          <p className="status-message" role="status">
            {statusMessage}
          </p>
        )}
        {validationError && (
          <p className="error-message" role="alert">
            {validationError}
          </p>
        )}
        {errorMessage && (
          <p className="error-message" role="alert">
            {errorMessage}
          </p>
        )}

        {/* WORKSPACE VIEW 1: DRAFT EDITOR */}
        {selectedAlert.status === "DRAFT" && !isPreviewing && (
          <section className="draft-editor" aria-label="Alert Draft Editor">
            <h3>Edit Alert Content & Target Zones</h3>

            <div className="form-group">
              <label htmlFor="severity-select">Alert Severity Level</label>
              <select
                id="severity-select"
                value={severity}
                disabled={Boolean(isLoading)}
                onChange={(e) => setSeverity(e.target.value as any)}
              >
                <option value="ADVISORY">ADVISORY (General Public Awareness)</option>
                <option value="WARNING">WARNING (Potential Danger / Prepare)</option>
                <option value="EVACUATION">EVACUATION (Immediate Danger / Evacuate)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Select Target Geographical Zones</label>
              <div className="zones-grid" role="group" aria-label="Target Zones">
                {INITIAL_TARGET_ZONES.map((zone) => {
                  const isChecked = selectedZoneIds.includes(zone.id);
                  return (
                    <label
                      key={zone.id}
                      htmlFor={`zone-input-${zone.id}`}
                      className={`zone-chip ${isChecked ? "checked" : ""}`}
                    >
                      <input
                        id={`zone-input-${zone.id}`}
                        type="checkbox"
                        checked={isChecked}
                        disabled={Boolean(isLoading)}
                        onChange={() => toggleZone(zone.id)}
                      />
                      <div>
                        <strong>
                          {zone.code} — {zone.name}
                        </strong>
                        <span>
                          {zone.districtName} District (~
                          {(zone.populationEstimate ?? 0).toLocaleString()} citizens)
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="alert-message">Public Alert Message</label>
              <textarea
                id="alert-message"
                rows={3}
                value={message}
                disabled={Boolean(isLoading)}
                placeholder="Enter clear, concise hazard alert details..."
                onChange={(e) => setMessage(e.target.value)}
              />
              <small>{message.length} / 1000 characters</small>
            </div>

            <div className="form-group">
              <label htmlFor="safety-instructions">Public Safety Instructions</label>
              <textarea
                id="safety-instructions"
                rows={3}
                value={safetyInstructions}
                disabled={Boolean(isLoading)}
                placeholder="Enter protective actions for citizens (e.g. evacuation routes, high ground)..."
                onChange={(e) => setSafetyInstructions(e.target.value)}
              />
              <small>{safetyInstructions.length} / 1000 characters</small>
            </div>

            <div className="actions-bar">
              <button disabled={Boolean(isLoading)} onClick={handleSaveDraft}>
                {isLoading === "Saving draft..." ? "Saving..." : "Save Draft"}
              </button>
              <button
                className="primary-button"
                disabled={Boolean(isLoading)}
                onClick={handlePreview}
              >
                {isLoading === "Loading preview..." ? "Loading..." : "Preview & Validate Broadcast"}
              </button>
            </div>
          </section>
        )}

        {/* WORKSPACE VIEW 2: PREVIEW & CONFIRM BROADCAST */}
        {isPreviewing && (
          <section className="preview-section" aria-label="Alert Preview Section">
            <h3>Broadcast Preview</h3>
            <p className="preview-intro">
              Review how the public alert will appear before triggering broadcast transmission.
            </p>

            <div className={`preview-card severity-${severity.toLowerCase()}`}>
              <div className="preview-badge">{severity} LEVEL ALERT</div>
              <h4>{selectedAlert.hazardType} EMERGENCY BROADCAST</h4>
              <p className="preview-msg">{message}</p>
              <div className="preview-instructions">
                <strong>Safety Directive:</strong> {safetyInstructions}
              </div>
              <div className="preview-meta">
                <span>Target Zones: {selectedZoneIds.length} Zone(s)</span>
                <span>Reach: ~{estimatedReach.toLocaleString()} estimated recipients</span>
              </div>
            </div>

            {similarActiveAlerts.length > 0 && (
              <div className="conflict-warning" role="alert">
                <strong>Similar Active Alert Detected:</strong> An active {selectedAlert.hazardType}{" "}
                alert already covers overlapping target zones. Broadcasting this will result in
                concurrent active hazard warnings.
              </div>
            )}

            {!isConfirmingSend ? (
              <div className="actions-bar">
                <button disabled={Boolean(isLoading)} onClick={() => setIsPreviewing(false)}>
                  Back to Edit
                </button>
                <button
                  className="primary-button send-button"
                  disabled={Boolean(isLoading)}
                  onClick={() => setIsConfirmingSend(true)}
                >
                  Confirm & Send Broadcast
                </button>
              </div>
            ) : (
              <div
                className="confirmation-modal"
                role="dialog"
                aria-label="Confirm Broadcast Dialog"
              >
                <h4>Irreversible Action Confirmation</h4>
                <p>
                  Broadcasting will immediately transition this alert to <strong>ACTIVE</strong>,
                  initiate Push notifications across{" "}
                  <strong>{selectedZoneIds.length} target zones</strong> (~
                  {estimatedReach.toLocaleString()} recipients), and record an official DMC
                  broadcast audit.
                </p>
                <div className="modal-actions">
                  <button disabled={Boolean(isLoading)} onClick={() => setIsConfirmingSend(false)}>
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    disabled={Boolean(isLoading)}
                    onClick={handleConfirmBroadcast}
                  >
                    {isLoading === "Broadcasting alert..."
                      ? "Broadcasting..."
                      : "Yes, Broadcast Alert Now"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* WORKSPACE VIEW 3: ACTIVE ALERT DETAILS & DELIVERY MONITORING */}
        {selectedAlert.status === "ACTIVE" && !isCancelling && (
          <section className="active-monitoring" aria-label="Active Alert Monitoring">
            <div className="metrics-grid">
              <div className="metric-card">
                <span className="metric-value">
                  {currentDeliveries?.summary.total.toLocaleString() ?? "—"}
                </span>
                <span className="metric-label">Total Recipients</span>
              </div>
              <div className="metric-card">
                <span className="metric-value text-success">
                  {currentDeliveries?.summary.pushSent.toLocaleString() ?? "—"}
                </span>
                <span className="metric-label">Push Delivered</span>
              </div>
              <div className="metric-card">
                <span className="metric-value text-info">
                  {currentDeliveries?.summary.smsSent.toLocaleString() ?? "—"}
                </span>
                <span className="metric-label">SMS Fallback Delivered</span>
              </div>
              <div className="metric-card">
                <span className="metric-value text-danger">
                  {currentDeliveries?.summary.failedFinal.toLocaleString() ?? "—"}
                </span>
                <span className="metric-label">Final Failures</span>
              </div>
            </div>

            <div className="delivery-log-header">
              <h3>Notification Delivery Log</h3>
              {currentDeliveries && currentDeliveries.summary.failedFinal > 0 && (
                <button
                  className="secondary-button"
                  disabled={Boolean(isLoading)}
                  onClick={handleRetryDeliveries}
                >
                  {isLoading === "Retrying failed deliveries..."
                    ? "Retrying..."
                    : "Retry Failed Deliveries"}
                </button>
              )}
            </div>

            <table className="delivery-table" aria-label="Deliveries Table">
              <thead>
                <tr>
                  <th>Recipient Ref</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Failure Reason / Note</th>
                </tr>
              </thead>
              <tbody>
                {currentDeliveries?.deliveries.map((deliv) => (
                  <tr key={deliv.id}>
                    <td>
                      <code>{deliv.recipientRef}</code>
                    </td>
                    <td>{deliv.channel ?? "PUSH"}</td>
                    <td>
                      <span className={`status-badge status-${deliv.status.toLowerCase()}`}>
                        {deliv.status}
                      </span>
                    </td>
                    <td>{deliv.attemptNo}</td>
                    <td>{deliv.lastFailureReason ?? "Delivered successfully"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="lifecycle-actions">
              <button disabled={Boolean(isLoading)} onClick={handleCreateReplacement}>
                {isLoading === "Creating replacement draft..."
                  ? "Creating replacement..."
                  : `Create Update / Replacement (v${selectedAlert.version + 1})`}
              </button>
              <button
                className="danger-button"
                disabled={Boolean(isLoading)}
                onClick={() => setIsCancelling(true)}
              >
                Cancel Alert / Issue All Clear
              </button>
            </div>
          </section>
        )}

        {/* WORKSPACE VIEW 4: CANCEL / ALL CLEAR DIALOG */}
        {isCancelling && (
          <section className="cancel-dialog" role="dialog" aria-label="Cancel and All Clear Dialog">
            <h3>Cancel Active Alert & Issue All Clear</h3>
            <p>
              Cancelling this alert will transition status to <strong>CANCELLED</strong> and
              immediately transmit an <strong>[ALL CLEAR]</strong> notification to all target-zone
              recipients.
            </p>

            <div className="form-group">
              <label htmlFor="cancel-reason">
                Official All Clear / Cancellation Reason (10-500 characters)
              </label>
              <textarea
                id="cancel-reason"
                rows={3}
                value={cancelReason}
                disabled={Boolean(isLoading)}
                placeholder="e.g. Flood waters have completely receded and all roads are open..."
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <small>{cancelReason.length} / 500 characters (min 10)</small>
            </div>

            {cancelReason.trim().length >= 10 && (
              <div className="all-clear-preview">
                <strong>All Clear Notification Preview:</strong>
                <p>
                  <code>[ALL CLEAR] {cancelReason.trim()}</code>
                </p>
              </div>
            )}

            <div className="modal-actions">
              <button disabled={Boolean(isLoading)} onClick={() => setIsCancelling(false)}>
                Dismiss / Keep Active
              </button>
              <button
                className="danger-button"
                disabled={Boolean(isLoading)}
                onClick={handleCancelAlert}
              >
                {isLoading === "Cancelling alert..."
                  ? "Cancelling..."
                  : "Confirm All Clear & Cancel Alert"}
              </button>
            </div>
          </section>
        )}

        {/* WORKSPACE VIEW 5: HISTORICAL ALERT (SUPERSEDED / CANCELLED) */}
        {(selectedAlert.status === "SUPERSEDED" || selectedAlert.status === "CANCELLED") && (
          <section className="historical-view" aria-label="Historical Alert View">
            <div className="info-banner">
              This alert is <strong>{selectedAlert.status}</strong> and is archived for audit
              purposes.
              {selectedAlert.cancellationReason && (
                <p>
                  <strong>Cancellation Reason:</strong> {selectedAlert.cancellationReason}
                </p>
              )}
            </div>

            <dl className="meta-list">
              <dt>Hazard Type</dt>
              <dd>{selectedAlert.hazardType}</dd>
              <dt>Severity</dt>
              <dd>{selectedAlert.severity}</dd>
              <dt>Version</dt>
              <dd>v{selectedAlert.version}</dd>
              <dt>Issued At</dt>
              <dd>{displayTime(selectedAlert.issuedAt)}</dd>
              {selectedAlert.cancelledAt && (
                <>
                  <dt>Cancelled At</dt>
                  <dd>{displayTime(selectedAlert.cancelledAt)}</dd>
                </>
              )}
            </dl>
          </section>
        )}
      </article>
    </section>
  );
}

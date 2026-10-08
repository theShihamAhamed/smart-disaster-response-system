import { useEffect, useState, type ReactNode } from "react";
import type {
  AlertPreviewInfo,
  AlertSummaryItem,
  BroadcastApi,
  DeliveryItem,
  DeliverySummary,
  TargetZoneOption,
} from "./broadcast-api";
import "./broadcast.css";

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

/* ------------------------------------------------------------------ */
/* Presentation helpers (UI only — no business logic)                  */
/* ------------------------------------------------------------------ */

type IconName =
  | "flood"
  | "cyclone"
  | "landslide"
  | "drought"
  | "alert"
  | "broadcast"
  | "users"
  | "pin"
  | "clock"
  | "check"
  | "checkCircle"
  | "xCircle"
  | "send"
  | "save"
  | "eye"
  | "refresh"
  | "layers"
  | "arrowLeft"
  | "shield"
  | "info"
  | "archive"
  | "phone"
  | "message"
  | "bell"
  | "loader"
  | "edit"
  | "inbox";

const ICON_PATHS: Record<IconName, ReactNode> = {
  flood: (
    <>
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </>
  ),
  cyclone: (
    <>
      <path d="M21 4H3" />
      <path d="M18 8H6" />
      <path d="M19 12H9" />
      <path d="M16 16h-6" />
      <path d="M11 20H9" />
    </>
  ),
  landslide: <path d="m8 3 4 8 5-5 5 15H2L8 3z" />,
  drought: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  broadcast: (
    <>
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
  xCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 10 5-10 5L2 7l10-5z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  archive: (
    <>
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </>
  ),
  phone: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  loader: <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
};

function Icon({
  name,
  size = 18,
  className,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <svg
      className={className ? `bd-icon ${className}` : "bd-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

const HAZARD_ICON: Record<string, IconName> = {
  FLOOD: "flood",
  CYCLONE: "cyclone",
  LANDSLIDE: "landslide",
  DROUGHT: "drought",
};

const SEVERITY_OPTIONS = [
  {
    value: "ADVISORY",
    label: "Advisory",
    description: "General public awareness",
  },
  {
    value: "WARNING",
    label: "Warning",
    description: "Potential danger — prepare",
  },
  {
    value: "EVACUATION",
    label: "Evacuation",
    description: "Immediate danger — evacuate",
  },
] as const;

const TOTAL_ZONE_POPULATION = INITIAL_TARGET_ZONES.reduce(
  (sum, z) => sum + (z.populationEstimate ?? 0),
  0,
);

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function hazardIcon(hazardType: string): IconName {
  return HAZARD_ICON[hazardType] ?? "alert";
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

const DRAFT_STEPS = ["Compose", "Preview", "Confirm", "Live"] as const;

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

  /* ---------- Derived, display-only values ---------- */
  const activeAlerts = alerts.filter((a) => a.status === "ACTIVE");
  const draftCount = alerts.filter((a) => a.status === "DRAFT").length;
  const citizensCovered = calculateEstimate([...new Set(activeAlerts.flatMap((a) => a.targetZoneIds))]);
  const lastIssued = alerts
    .map((a) => a.issuedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  const isDraftFlow = selectedAlert.status === "DRAFT" || isPreviewing;
  const currentStep = isConfirmingSend ? 2 : isPreviewing ? 1 : 0;
  const workspaceSeverity = (
    selectedAlert.status === "DRAFT" ? severity : selectedAlert.severity
  ).toLowerCase();
  const reachShare = percent(calculateEstimate(selectedZoneIds), TOTAL_ZONE_POPULATION);

  const summary = currentDeliveries?.summary;
  const deliveredCount = summary ? summary.pushSent + summary.smsSent : 0;
  const deliveryRate = summary ? percent(deliveredCount, summary.total) : 0;
  const otherCount = summary
    ? Math.max(summary.total - summary.pushSent - summary.smsSent - summary.failedFinal, 0)
    : 0;

  const selectedZones = INITIAL_TARGET_ZONES.filter((z) => selectedZoneIds.includes(z.id));
  const busy = Boolean(isLoading);

  return (
    <section className="bd" aria-label="Broadcast Hazard Alert Dashboard">
      {/* ============ COMMAND CENTRE HERO ============ */}
      <header className="bd-hero">
        <div className="bd-hero__glow" aria-hidden="true" />
        <div className="bd-hero__intro">
          <span className="bd-hero__eyebrow">
            <span className="bd-live-dot" aria-hidden="true" />
            Emergency Broadcast Centre
          </span>
          <p className="bd-hero__title">Broadcast Hazard Alerts</p>
          <p className="bd-hero__subtitle">
            Compose, validate and dispatch verified hazard warnings to citizens across target
            zones — then monitor delivery in real time.
          </p>
        </div>
        <dl className="bd-hero__stats">
          <div className="bd-stat">
            <dt>
              <Icon name="broadcast" size={16} /> Live broadcasts
            </dt>
            <dd>{activeAlerts.length}</dd>
          </div>
          <div className="bd-stat">
            <dt>
              <Icon name="edit" size={16} /> Drafts pending
            </dt>
            <dd>{draftCount}</dd>
          </div>
          <div className="bd-stat">
            <dt>
              <Icon name="users" size={16} /> Citizens covered
            </dt>
            <dd>{citizensCovered.toLocaleString()}</dd>
          </div>
          <div className="bd-stat">
            <dt>
              <Icon name="clock" size={16} /> Last dispatch
            </dt>
            <dd className="bd-stat__small">{lastIssued ? displayTime(lastIssued) : "—"}</dd>
          </div>
        </dl>
      </header>

      <div className="bd-layout">
        {/* ============ LEFT: ALERT QUEUE ============ */}
        <aside className="bd-queue">
          <div className="bd-queue__head">
            <div>
              <div className="bd-kicker">DMC Duty Officer</div>
              <h2>Hazard Broadcast Queue</h2>
            </div>
            <span className="bd-queue__count" aria-hidden="true">
              {alerts.length}
            </span>
          </div>

          <div className="bd-segmented" role="tablist" aria-label="Filter alerts">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "ALL"}
              className={activeTab === "ALL" ? "is-selected" : ""}
              onClick={() => setActiveTab("ALL")}
            >
              All ({alerts.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "ACTIVE"}
              className={activeTab === "ACTIVE" ? "is-selected" : ""}
              onClick={() => setActiveTab("ACTIVE")}
            >
              Active ({activeAlerts.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "DRAFTS"}
              className={activeTab === "DRAFTS" ? "is-selected" : ""}
              onClick={() => setActiveTab("DRAFTS")}
            >
              Drafts ({draftCount})
            </button>
          </div>

          {filteredAlerts.length === 0 ? (
            <div className="bd-empty">
              <Icon name="inbox" size={28} />
              <p>No alerts in this view.</p>
            </div>
          ) : (
            <ul className="bd-queue__list">
              {filteredAlerts.map((alert, index) => (
                <li key={alert.id} style={{ animationDelay: `${index * 45}ms` }}>
                  <button
                    type="button"
                    className={`bd-qcard sev-${alert.severity.toLowerCase()} ${
                      selectedAlertId === alert.id ? "is-selected" : ""
                    }`}
                    onClick={() => selectAlert(alert)}
                    aria-label={`Select alert ${alert.hazardType} Version ${alert.version} (${alert.status})`}
                  >
                    <span className="bd-qcard__icon">
                      <Icon name={hazardIcon(alert.hazardType)} size={20} />
                    </span>
                    <span className="bd-qcard__body">
                      <span className="bd-qcard__top">
                        <strong>{titleCase(alert.hazardType)}</strong>
                        <span className={`bd-pill bd-pill--${alert.status.toLowerCase()}`}>
                          {alert.status}
                        </span>
                      </span>
                      <span className="bd-qcard__msg">{alert.message}</span>
                      <span className="bd-qcard__meta">
                        <span className={`bd-sev-tag sev-${alert.severity.toLowerCase()}`}>
                          {titleCase(alert.severity)}
                        </span>
                        <span>v{alert.version}</span>
                        <span>
                          <Icon name="pin" size={12} /> {alert.targetZoneIds.length} zone
                          {alert.targetZoneIds.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="bd-qcard__time">
                        <Icon name="clock" size={12} />
                        {displayTime(alert.issuedAt ?? alert.cancelledAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ============ RIGHT: WORKSPACE ============ */}
        <div className={`bd-workspace sev-${workspaceSeverity}`}>
          <div className="bd-ws-head">
            <span className="bd-ws-head__icon">
              <Icon name={hazardIcon(selectedAlert.hazardType)} size={26} />
            </span>
            <div className="bd-ws-head__text">
              <div className="bd-kicker">Broadcast Management</div>
              <h2>{titleCase(selectedAlert.hazardType)} Alert</h2>
              <div className="bd-ws-head__chips">
                <span className={`bd-pill bd-pill--${selectedAlert.status.toLowerCase()}`}>
                  {selectedAlert.status}
                </span>
                <span className="bd-chip">
                  <Icon name="layers" size={13} /> Version {selectedAlert.version}
                </span>
                <span className="bd-chip">
                  <Icon name="pin" size={13} /> {selectedAlert.targetZoneIds.length} target zone
                  {selectedAlert.targetZoneIds.length === 1 ? "" : "s"}
                </span>
                {selectedAlert.issuedAt && (
                  <span className="bd-chip">
                    <Icon name="clock" size={13} /> {displayTime(selectedAlert.issuedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {isDraftFlow && (
            <ol className="bd-steps" aria-label="Broadcast progress">
              {DRAFT_STEPS.map((step, i) => (
                <li
                  key={step}
                  className={i < currentStep ? "is-done" : i === currentStep ? "is-current" : ""}
                >
                  <span className="bd-steps__dot">
                    {i < currentStep ? <Icon name="check" size={13} /> : i + 1}
                  </span>
                  <span className="bd-steps__label">{step}</span>
                </li>
              ))}
            </ol>
          )}

          {selectedAlert.parentAlertId && (
            <div className="bd-banner bd-banner--info" role="note">
              <Icon name="layers" />
              <span>
                Replacement Update: <strong>Version {selectedAlert.version}</strong> (replaces parent
                alert <code>{selectedAlert.parentAlertId}</code>)
              </span>
            </div>
          )}

          {isLoading && (
            <div className="bd-banner bd-banner--loading" role="status">
              <Icon name="loader" className="bd-spin" />
              <span>{isLoading}</span>
            </div>
          )}
          {statusMessage && (
            <div className="bd-banner bd-banner--success" role="status">
              <Icon name="checkCircle" />
              <span>{statusMessage}</span>
            </div>
          )}
          {validationError && (
            <div className="bd-banner bd-banner--error" role="alert">
              <Icon name="alert" />
              <span>{validationError}</span>
            </div>
          )}
          {errorMessage && (
            <div className="bd-banner bd-banner--error" role="alert">
              <Icon name="xCircle" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="bd-view" key={`${selectedAlertId}-${isPreviewing}-${isCancelling}`}>
            {/* ---------- VIEW 1: DRAFT EDITOR ---------- */}
            {selectedAlert.status === "DRAFT" && !isPreviewing && (
              <section className="bd-editor" aria-label="Alert Draft Editor">
                <div className="bd-editor__form">
                  <h3 className="bd-section-title">
                    <Icon name="edit" /> Edit Alert Content &amp; Target Zones
                  </h3>

                  <fieldset className="bd-field" disabled={busy}>
                    <legend className="bd-label">Alert Severity Level</legend>
                    <div className="bd-severity">
                      {SEVERITY_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          htmlFor={`severity-${opt.value}`}
                          className={`bd-sev-card sev-${opt.value.toLowerCase()} ${
                            severity === opt.value ? "is-checked" : ""
                          }`}
                        >
                          <input
                            id={`severity-${opt.value}`}
                            className="bd-sr-only"
                            type="radio"
                            name="bd-severity"
                            value={opt.value}
                            checked={severity === opt.value}
                            onChange={() => setSeverity(opt.value)}
                          />
                          <span className="bd-sev-card__bar" aria-hidden="true" />
                          <strong>{opt.label}</strong>
                          <small>{opt.description}</small>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="bd-field">
                    <div className="bd-label-row">
                      <span className="bd-label">Select Target Geographical Zones</span>
                      <span className="bd-label-hint">
                        {selectedZoneIds.length} of {INITIAL_TARGET_ZONES.length} selected
                      </span>
                    </div>
                    <div className="bd-zones" role="group" aria-label="Target Zones">
                      {INITIAL_TARGET_ZONES.map((zone) => {
                        const isChecked = selectedZoneIds.includes(zone.id);
                        return (
                          <label
                            key={zone.id}
                            htmlFor={`zone-input-${zone.id}`}
                            className={`bd-zone ${isChecked ? "is-checked" : ""}`}
                          >
                            <input
                              id={`zone-input-${zone.id}`}
                              className="bd-sr-only"
                              type="checkbox"
                              checked={isChecked}
                              disabled={busy}
                              onChange={() => toggleZone(zone.id)}
                            />
                            <span className="bd-zone__check" aria-hidden="true">
                              <Icon name="check" size={12} />
                            </span>
                            <span className="bd-zone__body">
                              <strong className="bd-zone__name">
                                <span className="bd-zone__code">{zone.code}</span>
                                <span className="bd-zone__sep"> — </span>
                                {zone.name}
                              </strong>
                              <span className="bd-zone__meta">
                                {zone.districtName} District (~
                                {(zone.populationEstimate ?? 0).toLocaleString()} citizens)
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="bd-reach">
                      <div className="bd-reach__text">
                        <Icon name="users" size={16} />
                        <span>
                          Estimated reach{" "}
                          <strong>~{calculateEstimate(selectedZoneIds).toLocaleString()}</strong>{" "}
                          citizens
                        </span>
                        <em>{reachShare}% of monitored population</em>
                      </div>
                      <div className="bd-meter" aria-hidden="true">
                        <span style={{ width: `${reachShare}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="bd-field">
                    <label className="bd-label" htmlFor="alert-message">
                      Public Alert Message
                    </label>
                    <textarea
                      id="alert-message"
                      className="bd-input"
                      rows={3}
                      value={message}
                      disabled={busy}
                      placeholder="Enter clear, concise hazard alert details..."
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <div className="bd-counter">
                      <div className="bd-counter__bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(message.length / 10, 100)}%` }} />
                      </div>
                      <small>{message.length} / 1000 characters</small>
                    </div>
                  </div>

                  <div className="bd-field">
                    <label className="bd-label" htmlFor="safety-instructions">
                      Public Safety Instructions
                    </label>
                    <textarea
                      id="safety-instructions"
                      className="bd-input"
                      rows={3}
                      value={safetyInstructions}
                      disabled={busy}
                      placeholder="Enter protective actions for citizens (e.g. evacuation routes, high ground)..."
                      onChange={(e) => setSafetyInstructions(e.target.value)}
                    />
                    <div className="bd-counter">
                      <div className="bd-counter__bar" aria-hidden="true">
                        <span
                          style={{ width: `${Math.min(safetyInstructions.length / 10, 100)}%` }}
                        />
                      </div>
                      <small>{safetyInstructions.length} / 1000 characters</small>
                    </div>
                  </div>

                  <div className="bd-actions">
                    <button
                      type="button"
                      className="bd-btn bd-btn--ghost"
                      disabled={busy}
                      onClick={handleSaveDraft}
                    >
                      <Icon name="save" size={16} />
                      {isLoading === "Saving draft..." ? "Saving..." : "Save Draft"}
                    </button>
                    <button
                      type="button"
                      className="bd-btn bd-btn--primary"
                      disabled={busy}
                      onClick={handlePreview}
                    >
                      <Icon name="eye" size={16} />
                      {isLoading === "Loading preview..."
                        ? "Loading..."
                        : "Preview & Validate Broadcast"}
                    </button>
                  </div>
                </div>

                <div className="bd-editor__aside" aria-hidden="true">
                  <div className="bd-aside-label">
                    <Icon name="phone" size={14} /> Live citizen preview
                  </div>
                  <PhonePreview
                    hazardType={selectedAlert.hazardType}
                    severity={severity}
                    message={message}
                    instructions={safetyInstructions}
                    zones={selectedZones.map((z) => z.code ?? z.name)}
                  />
                </div>
              </section>
            )}

            {/* ---------- VIEW 2: PREVIEW & CONFIRM ---------- */}
            {isPreviewing && (
              <section className="bd-preview" aria-label="Alert Preview Section">
                <h3 className="bd-section-title">
                  <Icon name="eye" /> Broadcast Preview
                </h3>
                <p className="bd-muted">
                  Review how the public alert will appear before triggering broadcast transmission.
                </p>

                <div className="bd-preview__grid">
                  <div className={`bd-official sev-${severity.toLowerCase()}`}>
                    <div className="bd-official__head">
                      <span className="bd-official__badge">
                        <Icon name="alert" size={14} />
                        {severity} LEVEL ALERT
                      </span>
                      <span className="bd-official__org">Disaster Management Centre</span>
                    </div>
                    <h4>{selectedAlert.hazardType} EMERGENCY BROADCAST</h4>
                    <p className="bd-official__msg">{message}</p>
                    <div className="bd-official__directive">
                      <Icon name="shield" size={18} />
                      <div>
                        <strong>Safety Directive:</strong> {safetyInstructions}
                      </div>
                    </div>
                    <div className="bd-official__meta">
                      <span>
                        <Icon name="pin" size={14} /> Target Zones: {selectedZoneIds.length} Zone(s)
                      </span>
                      <span>
                        <Icon name="users" size={14} /> Reach: ~{estimatedReach.toLocaleString()}{" "}
                        estimated recipients
                      </span>
                    </div>
                    <div className="bd-official__zones">
                      {selectedZones.map((z) => (
                        <span key={z.id} className="bd-chip bd-chip--light">
                          {z.code} · {z.districtName}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="bd-preview__phone" aria-hidden="true">
                    <PhonePreview
                      hazardType={selectedAlert.hazardType}
                      severity={severity}
                      message={message}
                      instructions={safetyInstructions}
                      zones={selectedZones.map((z) => z.code ?? z.name)}
                    />
                  </div>
                </div>

                {similarActiveAlerts.length > 0 && (
                  <div className="bd-banner bd-banner--warning" role="alert">
                    <Icon name="alert" />
                    <span>
                      <strong>Similar Active Alert Detected:</strong> An active{" "}
                      {selectedAlert.hazardType} alert already covers overlapping target zones.
                      Broadcasting this will result in concurrent active hazard warnings.
                    </span>
                  </div>
                )}

                <div className="bd-actions">
                  <button
                    type="button"
                    className="bd-btn bd-btn--ghost"
                    disabled={busy || isConfirmingSend}
                    onClick={() => setIsPreviewing(false)}
                  >
                    <Icon name="arrowLeft" size={16} />
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    className="bd-btn bd-btn--primary bd-btn--glow"
                    disabled={busy || isConfirmingSend}
                    onClick={() => setIsConfirmingSend(true)}
                  >
                    <Icon name="send" size={16} />
                    Confirm &amp; Send Broadcast
                  </button>
                </div>

                {isConfirmingSend && (
                  <div className="bd-modal-backdrop">
                    <div className="bd-modal" role="dialog" aria-label="Confirm Broadcast Dialog">
                      <span className="bd-modal__icon">
                        <Icon name="broadcast" size={28} />
                      </span>
                      <h4>Irreversible Action Confirmation</h4>
                      <p>
                        Broadcasting will immediately transition this alert to{" "}
                        <strong>ACTIVE</strong>, initiate Push notifications across{" "}
                        <strong>{selectedZoneIds.length} target zones</strong> (~
                        {estimatedReach.toLocaleString()} recipients), and record an official DMC
                        broadcast audit.
                      </p>
                      <ul className="bd-modal__facts">
                        <li>
                          <Icon name="alert" size={14} /> Severity: <strong>{severity}</strong>
                        </li>
                        <li>
                          <Icon name="pin" size={14} /> Zones:{" "}
                          <strong>{selectedZones.map((z) => z.code).join(", ")}</strong>
                        </li>
                      </ul>
                      <div className="bd-modal__actions">
                        <button
                          type="button"
                          className="bd-btn bd-btn--ghost"
                          disabled={busy}
                          onClick={() => setIsConfirmingSend(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="bd-btn bd-btn--danger"
                          disabled={busy}
                          onClick={handleConfirmBroadcast}
                        >
                          {isLoading === "Broadcasting alert..." ? (
                            <Icon name="loader" size={16} className="bd-spin" />
                          ) : (
                            <Icon name="send" size={16} />
                          )}
                          {isLoading === "Broadcasting alert..."
                            ? "Broadcasting..."
                            : "Yes, Broadcast Alert Now"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ---------- VIEW 3: ACTIVE MONITORING ---------- */}
            {selectedAlert.status === "ACTIVE" && !isCancelling && (
              <section className="bd-monitor" aria-label="Active Alert Monitoring">
                <div className="bd-live-card">
                  <div className="bd-live-card__badge">
                    <span className="bd-live-dot" aria-hidden="true" /> LIVE
                  </div>
                  <p className="bd-live-card__msg">{selectedAlert.message}</p>
                  <p className="bd-live-card__sub">
                    <Icon name="shield" size={14} /> {selectedAlert.safetyInstructions}
                  </p>
                </div>

                <div className="bd-kpis">
                  <div className="bd-kpi">
                    <span className="bd-kpi__icon">
                      <Icon name="users" />
                    </span>
                    <span className="bd-kpi__value">
                      {currentDeliveries?.summary.total.toLocaleString() ?? "—"}
                    </span>
                    <span className="bd-kpi__label">Total Recipients</span>
                  </div>
                  <div className="bd-kpi bd-kpi--success">
                    <span className="bd-kpi__icon">
                      <Icon name="bell" />
                    </span>
                    <span className="bd-kpi__value">
                      {currentDeliveries?.summary.pushSent.toLocaleString() ?? "—"}
                    </span>
                    <span className="bd-kpi__label">Push Delivered</span>
                  </div>
                  <div className="bd-kpi bd-kpi--info">
                    <span className="bd-kpi__icon">
                      <Icon name="message" />
                    </span>
                    <span className="bd-kpi__value">
                      {currentDeliveries?.summary.smsSent.toLocaleString() ?? "—"}
                    </span>
                    <span className="bd-kpi__label">SMS Fallback Delivered</span>
                  </div>
                  <div className="bd-kpi bd-kpi--danger">
                    <span className="bd-kpi__icon">
                      <Icon name="xCircle" />
                    </span>
                    <span className="bd-kpi__value">
                      {currentDeliveries?.summary.failedFinal.toLocaleString() ?? "—"}
                    </span>
                    <span className="bd-kpi__label">Final Failures</span>
                  </div>
                </div>

                {summary && summary.total > 0 && (
                  <div className="bd-rate">
                    <div className="bd-rate__head">
                      <span>Delivery success rate</span>
                      <strong>{deliveryRate}%</strong>
                    </div>
                    <div className="bd-stack" aria-hidden="true">
                      <span
                        className="bd-stack__push"
                        style={{ width: `${percent(summary.pushSent, summary.total)}%` }}
                      />
                      <span
                        className="bd-stack__sms"
                        style={{ width: `${percent(summary.smsSent, summary.total)}%` }}
                      />
                      <span
                        className="bd-stack__fail"
                        style={{ width: `${percent(summary.failedFinal, summary.total)}%` }}
                      />
                      <span
                        className="bd-stack__other"
                        style={{ width: `${percent(otherCount, summary.total)}%` }}
                      />
                    </div>
                    <ul className="bd-legend">
                      <li>
                        <i className="bd-stack__push" /> Push
                      </li>
                      <li>
                        <i className="bd-stack__sms" /> SMS fallback
                      </li>
                      <li>
                        <i className="bd-stack__fail" /> Failed
                      </li>
                      <li>
                        <i className="bd-stack__other" /> Pending / in-flight
                      </li>
                    </ul>
                  </div>
                )}

                <div className="bd-table-card">
                  <div className="bd-table-card__head">
                    <h3 className="bd-section-title">
                      <Icon name="broadcast" /> Notification Delivery Log
                    </h3>
                    {currentDeliveries && currentDeliveries.summary.failedFinal > 0 && (
                      <button
                        type="button"
                        className="bd-btn bd-btn--soft"
                        disabled={busy}
                        onClick={handleRetryDeliveries}
                      >
                        <Icon
                          name="refresh"
                          size={15}
                          {...(isLoading === "Retrying failed deliveries..."
                            ? { className: "bd-spin" }
                            : {})}
                        />
                        {isLoading === "Retrying failed deliveries..."
                          ? "Retrying..."
                          : "Retry Failed Deliveries"}
                      </button>
                    )}
                  </div>

                  <div className="bd-table-wrap">
                    <table className="bd-table" aria-label="Deliveries Table">
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
                            <td>
                              <span className="bd-channel">
                                <Icon
                                  name={(deliv.channel ?? "PUSH") === "SMS" ? "message" : "bell"}
                                  size={13}
                                />
                                {deliv.channel ?? "PUSH"}
                              </span>
                            </td>
                            <td>
                              <span className={`bd-pill bd-pill--${deliv.status.toLowerCase()}`}>
                                {deliv.status}
                              </span>
                            </td>
                            <td>
                              <span className="bd-attempts">{deliv.attemptNo}</span>
                            </td>
                            <td className="bd-table__note">
                              {deliv.lastFailureReason ?? "Delivered successfully"}
                            </td>
                          </tr>
                        ))}
                        {(!currentDeliveries || currentDeliveries.deliveries.length === 0) && (
                          <tr>
                            <td colSpan={5} className="bd-table__empty">
                              Delivery telemetry will appear here once recipients are processed.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bd-actions bd-actions--split">
                  <button
                    type="button"
                    className="bd-btn bd-btn--ghost"
                    disabled={busy}
                    onClick={handleCreateReplacement}
                  >
                    <Icon name="layers" size={16} />
                    {isLoading === "Creating replacement draft..."
                      ? "Creating replacement..."
                      : `Create Update / Replacement (v${selectedAlert.version + 1})`}
                  </button>
                  <button
                    type="button"
                    className="bd-btn bd-btn--danger-outline"
                    disabled={busy}
                    onClick={() => setIsCancelling(true)}
                  >
                    <Icon name="xCircle" size={16} />
                    Cancel Alert / Issue All Clear
                  </button>
                </div>
              </section>
            )}

            {/* ---------- VIEW 4: CANCEL / ALL CLEAR ---------- */}
            {isCancelling && (
              <section
                className="bd-cancel"
                role="dialog"
                aria-label="Cancel and All Clear Dialog"
              >
                <div className="bd-cancel__head">
                  <span className="bd-cancel__icon">
                    <Icon name="shield" size={22} />
                  </span>
                  <div>
                    <h3>Cancel Active Alert &amp; Issue All Clear</h3>
                    <p className="bd-muted">
                      Cancelling this alert will transition status to <strong>CANCELLED</strong> and
                      immediately transmit an <strong>[ALL CLEAR]</strong> notification to all
                      target-zone recipients.
                    </p>
                  </div>
                </div>

                <div className="bd-field">
                  <label className="bd-label" htmlFor="cancel-reason">
                    Official All Clear / Cancellation Reason (10-500 characters)
                  </label>
                  <textarea
                    id="cancel-reason"
                    className="bd-input"
                    rows={3}
                    value={cancelReason}
                    disabled={busy}
                    placeholder="e.g. Flood waters have completely receded and all roads are open..."
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                  <div className="bd-counter">
                    <div
                      className={`bd-counter__bar ${
                        cancelReason.trim().length >= 10 ? "is-valid" : ""
                      }`}
                      aria-hidden="true"
                    >
                      <span style={{ width: `${Math.min(cancelReason.length / 5, 100)}%` }} />
                    </div>
                    <small>{cancelReason.length} / 500 characters (min 10)</small>
                  </div>
                </div>

                {cancelReason.trim().length >= 10 && (
                  <div className="bd-allclear">
                    <span className="bd-allclear__icon">
                      <Icon name="checkCircle" size={18} />
                    </span>
                    <div>
                      <strong>All Clear Notification Preview:</strong>
                      <p>
                        <code>[ALL CLEAR] {cancelReason.trim()}</code>
                      </p>
                    </div>
                  </div>
                )}

                <div className="bd-actions">
                  <button
                    type="button"
                    className="bd-btn bd-btn--ghost"
                    disabled={busy}
                    onClick={() => setIsCancelling(false)}
                  >
                    <Icon name="arrowLeft" size={16} />
                    Dismiss / Keep Active
                  </button>
                  <button
                    type="button"
                    className="bd-btn bd-btn--danger"
                    disabled={busy}
                    onClick={handleCancelAlert}
                  >
                    <Icon name="shield" size={16} />
                    {isLoading === "Cancelling alert..."
                      ? "Cancelling..."
                      : "Confirm All Clear & Cancel Alert"}
                  </button>
                </div>
              </section>
            )}

            {/* ---------- VIEW 5: HISTORICAL ---------- */}
            {(selectedAlert.status === "SUPERSEDED" || selectedAlert.status === "CANCELLED") && (
              <section className="bd-history" aria-label="Historical Alert View">
                <div className="bd-banner bd-banner--muted">
                  <Icon name="archive" />
                  <div>
                    This alert is <strong>{selectedAlert.status}</strong> and is archived for audit
                    purposes.
                    {selectedAlert.cancellationReason && (
                      <p>
                        <strong>Cancellation Reason:</strong> {selectedAlert.cancellationReason}
                      </p>
                    )}
                  </div>
                </div>

                <blockquote className="bd-history__quote">
                  <p>{selectedAlert.message}</p>
                  <footer>
                    <Icon name="shield" size={14} /> {selectedAlert.safetyInstructions}
                  </footer>
                </blockquote>

                <dl className="bd-meta-grid">
                  <div>
                    <dt>Hazard Type</dt>
                    <dd>{selectedAlert.hazardType}</dd>
                  </div>
                  <div>
                    <dt>Severity</dt>
                    <dd>{selectedAlert.severity}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>v{selectedAlert.version}</dd>
                  </div>
                  <div>
                    <dt>Issued At</dt>
                    <dd>{displayTime(selectedAlert.issuedAt)}</dd>
                  </div>
                  {selectedAlert.cancelledAt && (
                    <div>
                      <dt>Cancelled At</dt>
                      <dd>{displayTime(selectedAlert.cancelledAt)}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Decorative citizen phone preview                                    */
/* ------------------------------------------------------------------ */
function PhonePreview({
  hazardType,
  severity,
  message,
  instructions,
  zones,
}: {
  readonly hazardType: string;
  readonly severity: string;
  readonly message: string;
  readonly instructions: string;
  readonly zones: readonly string[];
}) {
  return (
    <div className="bd-phone">
      <div className="bd-phone__notch" />
      <div className="bd-phone__status">
        <span>9:41</span>
        <span className="bd-phone__signal">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="bd-phone__clock">
        <span>9:41</span>
        <small>Emergency Alerts</small>
      </div>
      <div className={`bd-notif sev-${severity.toLowerCase()}`}>
        <div className="bd-notif__head">
          <span className="bd-notif__app">
            <Icon name="alert" size={12} />
          </span>
          <span>DMC ALERT · {severity}</span>
          <span className="bd-notif__time">now</span>
        </div>
        <strong className="bd-notif__title">{titleCase(hazardType)} emergency</strong>
        <p className="bd-notif__msg">{message.trim() || "Your alert message will appear here."}</p>
        {instructions.trim() && <p className="bd-notif__sub">{instructions}</p>}
        {zones.length > 0 && <span className="bd-notif__zones">{zones.join(" · ")}</span>}
      </div>
    </div>
  );
}

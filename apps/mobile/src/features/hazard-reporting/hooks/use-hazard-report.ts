import { useCallback, useEffect, useRef, useState } from "react";

// ⚠️ CHECK ME: these names come from your handoff. Match their arguments.
import {
  createDraft,
  setHazardType,
  setDescription,
  setPhoto,
  setGpsLocation,
  placePin,
  confirmPin,
} from "../form/report-draft";
import type { HazardType } from "@disaster/domain";
import type { Coordinates } from "../types";
import { validateDraft } from "../validation/report-validation";
import { captureGpsLocation } from "../services/gps-service";
import { describeResult, describeGpsFailure } from "../presentation/labels";
import {
  gpsProvider,
  submissionService,
  syncService,
  statusService,
  connectivity,
} from "../composition";

type AnyDraft = ReturnType<typeof createDraft>;

function createReportId(): string {
  let seed = Date.now();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = ((seed + Math.random() * 16) % 16) | 0;
    seed = Math.floor(seed / 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function useHazardReport() {
  const newReportId = useCallback(createReportId, []);
  const [draft, setDraft] = useState<AnyDraft>(() => createDraft(createReportId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [showManualMap, setShowManualMap] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [resultTone, setResultTone] = useState<string>("review");
  const [lastServerReportId, setLastServerReportId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const submittingRef = useRef(false); // stops double taps

  // When internet comes back, send queued reports.
  useEffect(() => {
    void syncService.syncQueue();
    const unsubscribe = connectivity.subscribe((online) => {
      if (online) {
        void syncService.syncQueue();
      }
    });
    return unsubscribe;
  }, []);

  const chooseHazard = useCallback((type: string) => {
    setDraft((d) => setHazardType(d, type as HazardType));
  }, []);

  const changeDescription = useCallback((text: string) => {
    setDraft((d) => setDescription(d, text));
  }, []);

  const choosePhoto = useCallback((uri: string) => {
    setDraft((d) => setPhoto(d, uri));
  }, []);

  const useGps = useCallback(async () => {
    setGpsMessage(null);
    const outcome = await captureGpsLocation(gpsProvider);
    if (outcome.kind === "OK") {
      setDraft((d) => setGpsLocation(d, outcome.position));
      setShowManualMap(false);
    } else {
      setGpsMessage(describeGpsFailure(outcome.reason).body);
      setShowManualMap(true);
    }
  }, []);

  const dropPin = useCallback((latitude: number, longitude: number) => {
    const pin: Coordinates = { latitude, longitude };
    setDraft((d) => placePin(d, pin));
  }, []);

  const acceptPin = useCallback(() => {
    setDraft((d) => confirmPin(d));
  }, []);

  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    const check = validateDraft(draft);
    const fieldErrors: Record<string, string> = check.ok ? {} : { ...check.errors };
    setErrors(fieldErrors);
    if (!check.ok) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await submissionService.submit(draft);
      const description = describeResult(result);
      setResultText(`${description.title}: ${description.body}`);
      setResultTone(description.tone);
      setLastServerReportId(result.kind === "SUBMITTED" ? result.acknowledgement.reportId : null);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [draft]);

  const refreshStatus = useCallback(async () => {
    if (!lastServerReportId) return;
    const report = await statusService.refresh(lastServerReportId);
    setStatusText(report?.acknowledgement?.status ?? "Unknown");
  }, [lastServerReportId]);

  const startNewReport = useCallback(() => {
    setDraft(createDraft(newReportId));
    setErrors({});
    setResultText(null);
    setResultTone("review");
    setGpsMessage(null);
    setShowManualMap(false);
    setStatusText(null);
    setLastServerReportId(null);
  }, [newReportId]);

  return {
    draft: draft as any,
    errors,
    gpsMessage,
    showManualMap,
    setShowManualMap,
    submitting,
    resultText,
    resultTone,
    statusText,
    lastServerReportId,
    chooseHazard,
    changeDescription,
    choosePhoto,
    useGps,
    dropPin,
    acceptPin,
    submit,
    refreshStatus,
    startNewReport,
  };
}

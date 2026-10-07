import { describe, expect, it, vi } from "vitest";
import { createBroadcastApi } from "./broadcast-api";

describe("createBroadcastApi", () => {
  it("calls createFromReport with POST /alerts/from-report/:reportId", async () => {
    const mockPost = vi.fn().mockResolvedValue({ id: "alert-1", status: "DRAFT" });
    const api = createBroadcastApi({
      get: vi.fn(),
      post: mockPost,
      patch: vi.fn(),
    });

    const result = await api.createFromReport("report-123");

    expect(mockPost).toHaveBeenCalledWith("/alerts/from-report/report-123");
    expect(result).toEqual({ id: "alert-1", status: "DRAFT" });
  });

  it("calls updateDraft with PATCH /alerts/:alertId and request body", async () => {
    const mockPatch = vi.fn().mockResolvedValue({ id: "alert-1", severity: "WARNING" });
    const api = createBroadcastApi({
      get: vi.fn(),
      post: vi.fn(),
      patch: mockPatch,
    });

    const body = {
      severity: "WARNING" as const,
      message: "Severe flood warning.",
      safetyInstructions: "Move to higher ground.",
      targetZoneIds: ["zone-1", "zone-2"],
    };
    const result = await api.updateDraft("alert-1", body);

    expect(mockPatch).toHaveBeenCalledWith("/alerts/alert-1", { body });
    expect(result).toEqual({ id: "alert-1", severity: "WARNING" });
  });

  it("calls getPreview with GET /alerts/:alertId/preview", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      alert: { id: "alert-1" },
      targetZones: [],
      estimatedRecipients: 5000,
    });
    const api = createBroadcastApi({
      get: mockGet,
      post: vi.fn(),
      patch: vi.fn(),
    });

    const result = await api.getPreview("alert-1");

    expect(mockGet).toHaveBeenCalledWith("/alerts/alert-1/preview");
    expect(result.estimatedRecipients).toBe(5000);
  });

  it("calls getSimilarActive with GET /alerts/:alertId/similar-active", async () => {
    const mockGet = vi.fn().mockResolvedValue([{ id: "alert-active-1" }]);
    const api = createBroadcastApi({
      get: mockGet,
      post: vi.fn(),
      patch: vi.fn(),
    });

    const result = await api.getSimilarActive("alert-1");

    expect(mockGet).toHaveBeenCalledWith("/alerts/alert-1/similar-active");
    expect(result).toHaveLength(1);
  });

  it("calls broadcastAlert with POST /alerts/:alertId/broadcast and Idempotency-Key header", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      alert: { id: "alert-1", status: "ACTIVE" },
      deliveries: [],
    });
    const api = createBroadcastApi({
      get: vi.fn(),
      post: mockPost,
      patch: vi.fn(),
    });

    const result = await api.broadcastAlert("alert-1", "idempotency-key-1");

    expect(mockPost).toHaveBeenCalledWith("/alerts/alert-1/broadcast", {
      headers: { "Idempotency-Key": "idempotency-key-1" },
    });
    expect(result.alert.status).toBe("ACTIVE");
  });

  it("calls getDeliveries with GET /alerts/:alertId/deliveries", async () => {
    const mockGet = vi.fn().mockResolvedValue({
      alertId: "alert-1",
      total: 100,
      pending: 0,
      pushSent: 90,
      pushFailed: 10,
      smsFallbackQueued: 0,
      smsSent: 8,
      failedFinal: 2,
      deliveries: [],
    });
    const api = createBroadcastApi({
      get: mockGet,
      post: vi.fn(),
      patch: vi.fn(),
    });

    const result = await api.getDeliveries("alert-1");

    expect(mockGet).toHaveBeenCalledWith("/alerts/alert-1/deliveries");
    expect(result.total).toBe(100);
    expect(result.pushSent).toBe(90);
  });

  it("calls retryDeliveries with POST /alerts/:alertId/deliveries/retry", async () => {
    const mockPost = vi.fn().mockResolvedValue({ alertId: "alert-1", results: [] });
    const api = createBroadcastApi({
      get: vi.fn(),
      post: mockPost,
      patch: vi.fn(),
    });

    const result = await api.retryDeliveries("alert-1");

    expect(mockPost).toHaveBeenCalledWith("/alerts/alert-1/deliveries/retry");
    expect(result.alertId).toBe("alert-1");
  });

  it("calls createReplacementDraft with POST /alerts/:parentAlertId/replacement-drafts", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      id: "alert-2",
      parentAlertId: "alert-1",
      version: 2,
      status: "DRAFT",
    });
    const api = createBroadcastApi({
      get: vi.fn(),
      post: mockPost,
      patch: vi.fn(),
    });

    const result = await api.createReplacementDraft("alert-1");

    expect(mockPost).toHaveBeenCalledWith("/alerts/alert-1/replacement-drafts");
    expect(result.version).toBe(2);
    expect(result.parentAlertId).toBe("alert-1");
  });

  it("calls cancelAlert with POST /alerts/:alertId/cancel, body, and Idempotency-Key header", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      id: "alert-1",
      status: "CANCELLED",
      cancellationReason: "Flood levels receded.",
    });
    const api = createBroadcastApi({
      get: vi.fn(),
      post: mockPost,
      patch: vi.fn(),
    });

    const result = await api.cancelAlert("alert-1", "Flood levels receded.", "cancel-key-1");

    expect(mockPost).toHaveBeenCalledWith("/alerts/alert-1/cancel", {
      body: { reason: "Flood levels receded." },
      headers: { "Idempotency-Key": "cancel-key-1" },
    });
    expect(result.status).toBe("CANCELLED");
  });
});

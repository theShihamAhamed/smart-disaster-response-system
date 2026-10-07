import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { BroadcastHazardDashboard } from "./BroadcastHazardDashboard";
import type { BroadcastApi } from "./broadcast-api";
import type { VerificationApi } from "../verification/verification-api";

afterEach(() => {
  cleanup();
});

const mockDraftAlert = {
  id: "50000000-0000-4000-8000-000000000001",
  sourceReportId: "40000000-0000-4000-8000-000000000002",
  hazardType: "FLOOD" as const,
  severity: "WARNING" as const,
  message: "Water levels rising rapidly in the Kelani River basin.",
  safetyInstructions: "Move valuables to upper floors.",
  status: "DRAFT" as const,
  version: 1,
  parentAlertId: null,
  targetZoneIds: ["30000000-0000-4000-8000-000000000001"],
  issuedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

const mockActiveAlert = {
  id: "50000000-0000-4000-8000-000000000002",
  sourceReportId: "40000000-0000-4000-8000-000000000004",
  hazardType: "FLOOD" as const,
  severity: "WARNING" as const,
  message: "Major flood warning active across downstream Kelani River basin.",
  safetyInstructions: "Stay away from riverbanks.",
  status: "ACTIVE" as const,
  version: 1,
  parentAlertId: null,
  targetZoneIds: [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002",
  ],
  issuedAt: "2026-09-25T10:00:00.000Z",
  cancelledAt: null,
  cancellationReason: null,
};

function createMockBroadcastApi(overrides: Partial<BroadcastApi> = {}): BroadcastApi {
  return {
    createFromReport: vi.fn().mockResolvedValue(mockDraftAlert),
    updateDraft: vi.fn().mockResolvedValue(mockDraftAlert),
    getPreview: vi.fn().mockResolvedValue({
      alert: mockDraftAlert,
      targetZones: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          name: "Colombo Critical Flood Zone",
          populationEstimate: 45000,
        },
      ],
      estimatedRecipients: 45000,
    }),
    getSimilarActive: vi.fn().mockResolvedValue([]),
    broadcastAlert: vi.fn().mockResolvedValue({
      alert: { ...mockDraftAlert, status: "ACTIVE", issuedAt: "2026-10-07T10:00:00.000Z" },
      deliveries: [
        {
          id: "deliv-1",
          alertId: mockDraftAlert.id,
          recipientRef: "+94770000001",
          channel: "PUSH",
          status: "PUSH_SENT",
          attemptNo: 1,
          lastFailureReason: null,
          updatedAt: "2026-10-07T10:00:00.000Z",
        },
      ],
    }),
    getDeliveries: vi.fn().mockResolvedValue({
      alertId: mockActiveAlert.id,
      total: 83000,
      pending: 0,
      pushSent: 81200,
      pushFailed: 1800,
      smsFallbackQueued: 0,
      smsSent: 1550,
      failedFinal: 250,
      deliveries: [
        {
          id: "deliv-101",
          alertId: mockActiveAlert.id,
          recipientRef: "+94771234567",
          channel: "PUSH",
          status: "PUSH_SENT",
          attemptNo: 1,
          lastFailureReason: null,
          updatedAt: "2026-10-07T08:31:00Z",
        },
        {
          id: "deliv-103",
          alertId: mockActiveAlert.id,
          recipientRef: "+94775551234",
          channel: "SMS",
          status: "FAILED_FINAL",
          attemptNo: 3,
          lastFailureReason: "Push timed out and SMS destination unreachable",
          updatedAt: "2026-10-07T08:34:00Z",
        },
      ],
    }),
    retryDeliveries: vi.fn().mockResolvedValue({ alertId: mockActiveAlert.id, results: [] }),
    createReplacementDraft: vi.fn().mockResolvedValue({
      ...mockActiveAlert,
      id: "50000000-0000-4000-8000-000000000099",
      version: 2,
      parentAlertId: mockActiveAlert.id,
      status: "DRAFT",
      issuedAt: null,
    }),
    cancelAlert: vi.fn().mockResolvedValue({
      ...mockActiveAlert,
      status: "CANCELLED",
      cancelledAt: "2026-10-07T11:00:00.000Z",
      cancellationReason: "Flood waters have receded completely and all roads are open.",
    }),
    ...overrides,
  };
}

describe("BroadcastHazardDashboard", () => {
  it("renders the dashboard with sidebar queue and initial draft form", () => {
    render(<BroadcastHazardDashboard />);

    expect(
      screen.getByRole("region", { name: /broadcast hazard alert dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /hazard broadcast queue/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /alert draft editor/i })).toBeInTheDocument();
  });

  it("allows selecting target zones via checkboxes", () => {
    render(<BroadcastHazardDashboard />);

    const kelaniMidReach = screen.getByLabelText(/KLN-02 — Colombo High Zone/i);
    expect(kelaniMidReach).not.toBeChecked();

    fireEvent.click(kelaniMidReach);
    expect(kelaniMidReach).toBeChecked();
  });

  it("validates that message, safety instructions, and target zones cannot be blank", () => {
    render(<BroadcastHazardDashboard />);

    const messageInput = screen.getByLabelText(/public alert message/i);
    fireEvent.change(messageInput, { target: { value: "   " } });

    const saveButton = screen.getByRole("button", { name: /save draft/i });
    fireEvent.click(saveButton);

    expect(screen.getByRole("alert")).toHaveTextContent("Alert message cannot be blank.");

    // Fill message but clear safety instructions
    fireEvent.change(messageInput, { target: { value: "Valid flood message" } });
    const safetyInput = screen.getByLabelText(/public safety instructions/i);
    fireEvent.change(safetyInput, { target: { value: "   " } });

    fireEvent.click(saveButton);
    expect(screen.getByRole("alert")).toHaveTextContent("Safety instructions cannot be blank.");
  });

  it("calls updateDraft when Save Draft is clicked with api prop", async () => {
    const api = createMockBroadcastApi();
    render(<BroadcastHazardDashboard api={api} />);

    const saveButton = screen.getByRole("button", { name: /save draft/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(api.updateDraft).toHaveBeenCalledWith(
        mockDraftAlert.id,
        expect.objectContaining({
          severity: "WARNING",
          message: expect.any(String),
          safetyInstructions: expect.any(String),
          targetZoneIds: expect.any(Array),
        }),
      );
    });

    expect(screen.getByRole("status")).toHaveTextContent("Draft alert saved successfully.");
  });

  it("calls getPreview and getSimilarActive when Preview is clicked with api prop", async () => {
    const api = createMockBroadcastApi({
      getSimilarActive: vi.fn().mockResolvedValue([
        {
          id: "50000000-0000-4000-8000-000000000002",
          hazardType: "FLOOD",
          status: "ACTIVE",
          targetZoneIds: ["30000000-0000-4000-8000-000000000001"],
        },
      ]),
    });
    render(<BroadcastHazardDashboard api={api} />);

    const previewButton = screen.getByRole("button", { name: /preview & validate broadcast/i });
    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(api.getPreview).toHaveBeenCalledWith(mockDraftAlert.id);
      expect(api.getSimilarActive).toHaveBeenCalledWith(mockDraftAlert.id);
    });

    expect(screen.getByRole("region", { name: /alert preview section/i })).toBeInTheDocument();
    expect(screen.getByText(/similar active alert detected/i)).toBeInTheDocument();
  });

  it("calls broadcastAlert when Confirm & Send Broadcast is clicked", async () => {
    const api = createMockBroadcastApi();
    render(<BroadcastHazardDashboard api={api} />);

    // Go to preview
    fireEvent.click(screen.getByRole("button", { name: /preview & validate broadcast/i }));

    await waitFor(() => {
      expect(api.getPreview).toHaveBeenCalled();
    });

    // Click confirm & send
    fireEvent.click(screen.getByRole("button", { name: /confirm & send broadcast/i }));

    // Confirm broadcast in modal
    fireEvent.click(screen.getByRole("button", { name: /yes, broadcast alert now/i }));

    await waitFor(() => {
      expect(api.broadcastAlert).toHaveBeenCalledWith(
        mockDraftAlert.id,
        expect.any(String),
      );
    });

    expect(screen.getByText(/alert broadcast successfully/i)).toBeInTheDocument();
  });

  it("calls getDeliveries when active alert is selected and displays delivery table", async () => {
    const api = createMockBroadcastApi();
    render(<BroadcastHazardDashboard api={api} />);

    // Select the active flood alert from the queue
    const activeAlertButton = screen.getByRole("button", {
      name: /select alert flood version 1 \(active\)/i,
    });
    fireEvent.click(activeAlertButton);

    await waitFor(() => {
      expect(api.getDeliveries).toHaveBeenCalledWith(mockActiveAlert.id);
    });

    expect(screen.getByRole("region", { name: /active alert monitoring/i })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /deliveries table/i })).toBeInTheDocument();
  });

  it("calls retryDeliveries and refreshes deliveries when retry button is clicked", async () => {
    const api = createMockBroadcastApi();
    render(<BroadcastHazardDashboard api={api} />);

    // Select active alert with failures
    fireEvent.click(
      screen.getByRole("button", { name: /select alert flood version 1 \(active\)/i }),
    );

    await waitFor(() => {
      expect(api.getDeliveries).toHaveBeenCalledWith(mockActiveAlert.id);
    });

    const retryButton = screen.getByRole("button", { name: /retry failed deliveries/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(api.retryDeliveries).toHaveBeenCalledWith(mockActiveAlert.id);
      expect(screen.getByText(/delivery retry triggered/i)).toBeInTheDocument();
    });
  });

  it("calls createReplacementDraft and loads new version draft into editor", async () => {
    const api = createMockBroadcastApi();
    render(<BroadcastHazardDashboard api={api} />);

    // Select active alert
    fireEvent.click(
      screen.getByRole("button", { name: /select alert flood version 1 \(active\)/i }),
    );

    const updateButton = screen.getByRole("button", {
      name: /create update \/ replacement \(v2\)/i,
    });
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(api.createReplacementDraft).toHaveBeenCalledWith(mockActiveAlert.id);
    });

    expect(screen.getByRole("note")).toHaveTextContent(/replacement update: version 2/i);
    expect(screen.getByRole("region", { name: /alert draft editor/i })).toBeInTheDocument();
  });

  it("validates cancel reason and calls cancelAlert with Idempotency-Key", async () => {
    const api = createMockBroadcastApi();
    render(<BroadcastHazardDashboard api={api} />);

    // Select active alert
    fireEvent.click(
      screen.getByRole("button", { name: /select alert flood version 1 \(active\)/i }),
    );

    // Click cancel
    fireEvent.click(screen.getByRole("button", { name: /cancel alert \/ issue all clear/i }));

    const cancelReasonInput = screen.getByLabelText(/official all clear \/ cancellation reason/i);
    const confirmCancelBtn = screen.getByRole("button", {
      name: /confirm all clear & cancel alert/i,
    });

    // Too short (< 10 chars)
    fireEvent.change(cancelReasonInput, { target: { value: "Short" } });
    fireEvent.click(confirmCancelBtn);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cancellation reason must be at least 10 characters.",
    );
    expect(api.cancelAlert).not.toHaveBeenCalled();

    // Valid reason
    const validReason = "Flood waters have receded completely and all roads are open.";
    fireEvent.change(cancelReasonInput, { target: { value: validReason } });
    fireEvent.click(confirmCancelBtn);

    await waitFor(() => {
      expect(api.cancelAlert).toHaveBeenCalledWith(
        mockActiveAlert.id,
        validReason,
        expect.any(String),
      );
    });

    expect(
      screen.getByText(/alert cancelled and all clear notification dispatched/i),
    ).toBeInTheDocument();
  });

  it("displays backend error message when api call fails with 409 conflict", async () => {
    const api = createMockBroadcastApi({
      updateDraft: vi.fn().mockRejectedValue({
        status: 409,
        body: {
          error: {
            code: "ALERT_NOT_IN_DRAFT",
            message: "Only draft alerts can be edited or broadcast.",
          },
        },
      }),
    });
    render(<BroadcastHazardDashboard api={api} />);

    const saveButton = screen.getByRole("button", { name: /save draft/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This alert is no longer a draft and cannot be edited or broadcast.",
      );
    });
  });
});

describe("App Navigation", () => {
  it("displays DMC Duty Officer navigation tabs and switches between Verification and Broadcast dashboards", () => {
    const mockVerificationApi: VerificationApi = {
      listPendingReports: vi.fn().mockResolvedValue([]),
      getReportForReview: vi.fn().mockResolvedValue({} as any),
      decideReport: vi.fn().mockResolvedValue({}),
    };
    const mockBroadcastApi = createMockBroadcastApi();

    render(
      <App
        verificationApi={mockVerificationApi}
        broadcastApi={mockBroadcastApi}
        initialView="verification"
      />,
    );

    // Navigation tabs exist
    const verificationTab = screen.getByRole("button", { name: /hazard verification/i });
    const broadcastTab = screen.getByRole("button", { name: /broadcast hazard alert/i });

    expect(verificationTab).toBeInTheDocument();
    expect(broadcastTab).toBeInTheDocument();

    // Verification is initially active
    expect(
      screen.getByRole("region", { name: /hazard verification dashboard/i }),
    ).toBeInTheDocument();

    // Switch to Broadcast Hazard Alert
    fireEvent.click(broadcastTab);
    expect(
      screen.getByRole("region", { name: /broadcast hazard alert dashboard/i }),
    ).toBeInTheDocument();

    // Switch back to Hazard Verification
    fireEvent.click(verificationTab);
    expect(
      screen.getByRole("region", { name: /hazard verification dashboard/i }),
    ).toBeInTheDocument();
  });
});

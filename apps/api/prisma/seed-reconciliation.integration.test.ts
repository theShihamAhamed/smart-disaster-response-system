import {
  AlertSeverity,
  AlertStatus,
  DeliveryStatus,
  HazardType,
  PartnerResupplyStatus,
  PrismaClient,
  ReportStatus,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  VerificationResult,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seed, seedIds } from "./seed.js";
import { verifySeed } from "./verify-seed-core.js";

function isIsolatedPostgres(urlValue: string | undefined): boolean {
  if (!urlValue) return false;
  try {
    const url = new URL(urlValue);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname.toLowerCase().includes("test")
    );
  } catch {
    return false;
  }
}

const integrationRequested = process.env.RUN_RELIEF_DB_INTEGRATION_TESTS === "true";
const isolatedDatabase = isIsolatedPostgres(process.env.DATABASE_URL);
if (integrationRequested && !isolatedDatabase) {
  throw new Error(
    "Seed reconciliation tests require a localhost PostgreSQL database whose name contains 'test'.",
  );
}

const describeIntegration = integrationRequested && isolatedDatabase ? describe : describe.skip;
let prisma: PrismaClient;

const ids = {
  pendingDecision: "d4200000-0000-4000-8000-000000000001",
  rejectedDecision: "d4200000-0000-4000-8000-000000000002",
  verificationDecision: "d4200000-0000-4000-8000-000000000003",
  runtimeAlert: "d5000000-0000-4000-8000-000000000001",
  runtimeReplacement: "d5000000-0000-4000-8000-000000000002",
  runtimeDelivery: "d5100000-0000-4000-8000-000000000001",
  runtimeAudit: "d5200000-0000-4000-8000-000000000001",
  allocation: "d7300000-0000-4000-8000-000000000001",
  allocationItem: "d7400000-0000-4000-8000-000000000001",
  distributionLog: "d7500000-0000-4000-8000-000000000001",
  resupply: "d7600000-0000-4000-8000-000000000001",
  dispatch: "d7700000-0000-4000-8000-000000000001",
  foreignRequest: "d7000000-0000-4000-8000-000000000001",
  foreignRequestItem: "d7100000-0000-4000-8000-000000000001",
  foreignAllocation: "d7300000-0000-4000-8000-000000000002",
  foreignDispatch: "d7700000-0000-4000-8000-000000000002",
  unrelatedReport: "d4000000-0000-4000-8000-000000000001",
  unrelatedClientReport: "d4100000-0000-4000-8000-000000000001",
  unrelatedAlert: "d5000000-0000-4000-8000-000000000003",
  unrelatedRequest: "d7000000-0000-4000-8000-000000000002",
  unrelatedRequestItem: "d7100000-0000-4000-8000-000000000002",
} as const;

async function cleanupFixtures(): Promise<void> {
  await prisma.transportDispatch.deleteMany({
    where: { id: { in: [ids.dispatch, ids.foreignDispatch] } },
  });
  await prisma.distributionLog.deleteMany({ where: { id: ids.distributionLog } });
  await prisma.allocationItem.deleteMany({
    where: { id: { in: [ids.allocationItem] } },
  });
  await prisma.partnerResupplyRequest.deleteMany({ where: { id: ids.resupply } });
  await prisma.resourceAllocation.deleteMany({
    where: { id: { in: [ids.allocation, ids.foreignAllocation] } },
  });
  await prisma.reliefRequestItem.deleteMany({
    where: { id: { in: [ids.foreignRequestItem, ids.unrelatedRequestItem] } },
  });
  await prisma.reliefRequest.deleteMany({
    where: { id: { in: [ids.foreignRequest, ids.unrelatedRequest] } },
  });
  await prisma.notificationDelivery.deleteMany({
    where: { id: { in: [ids.runtimeDelivery] } },
  });
  await prisma.broadcastAudit.deleteMany({ where: { id: ids.runtimeAudit } });
  await prisma.alertTargetZone.deleteMany({
    where: { alertId: { in: [ids.runtimeAlert, ids.runtimeReplacement, ids.unrelatedAlert] } },
  });
  await prisma.alert.deleteMany({ where: { id: ids.runtimeReplacement } });
  await prisma.alert.deleteMany({ where: { id: { in: [ids.runtimeAlert, ids.unrelatedAlert] } } });
  await prisma.verificationDecision.deleteMany({
    where: { id: { in: [ids.pendingDecision, ids.rejectedDecision, ids.verificationDecision] } },
  });
  await prisma.hazardReport.deleteMany({ where: { id: ids.unrelatedReport } });
}

async function createResettableAllocation(): Promise<void> {
  await prisma.resourceAllocation.create({
    data: {
      id: ids.allocation,
      requestId: seedIds.partialRequest,
      officerId: seedIds.districtOfficer,
      idempotencyKey: "da000000-0000-4000-8000-000000000001",
      notes: "integration allocation",
      createdAt: new Date("2026-09-25T11:00:00.000Z"),
    },
  });
  await prisma.allocationItem.create({
    data: {
      id: ids.allocationItem,
      allocationId: ids.allocation,
      requestItemId: "71000000-0000-4000-8000-000000000003",
      supplyType: SupplyType.WATER,
      allocatedQty: 100,
    },
  });
  await prisma.distributionLog.create({
    data: {
      id: ids.distributionLog,
      allocationId: ids.allocation,
      allocationItemId: ids.allocationItem,
      districtId: seedIds.district,
      supplyType: SupplyType.WATER,
      quantity: 100,
      createdAt: new Date("2026-09-25T11:00:00.000Z"),
    },
  });
  await prisma.partnerResupplyRequest.create({
    data: {
      id: ids.resupply,
      reliefRequestId: seedIds.partialRequest,
      partnerOrganisationId: seedIds.partner,
      supplyType: SupplyType.MEDICAL_KIT,
      requestedQty: 12,
      status: PartnerResupplyStatus.REQUESTED,
      createdAt: new Date("2026-09-25T11:00:00.000Z"),
    },
  });
  await prisma.transportDispatch.create({
    data: {
      id: ids.dispatch,
      allocationId: ids.allocation,
      rescueTeamId: seedIds.team,
      destinationLocationId: seedIds.shelterLocation,
      dispatchedAt: new Date("2026-09-25T11:00:00.000Z"),
    },
  });
  await prisma.warehouseStock.update({
    where: {
      districtId_supplyType: { districtId: seedIds.district, supplyType: SupplyType.WATER },
    },
    data: { availableQty: 200, version: 2 },
  });
  await prisma.reliefRequest.update({
    where: { id: seedIds.partialRequest },
    data: { status: ReliefRequestStatus.PARTIALLY_ALLOCATED, version: 2 },
  });
  await prisma.rescueTeam.update({
    where: { id: seedIds.team },
    data: { status: RescueTeamStatus.EN_ROUTE, version: 2 },
  });
}

async function createForeignDispatch(): Promise<void> {
  await prisma.reliefRequest.create({
    data: {
      id: ids.foreignRequest,
      shelterId: seedIds.shelter,
      targetZoneId: seedIds.highZone,
      status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
      priorityNote: "foreign dispatch safety fixture",
      createdAt: new Date("2026-09-25T12:00:00.000Z"),
      version: 2,
      items: {
        create: {
          id: ids.foreignRequestItem,
          supplyType: SupplyType.WATER,
          requestedQty: 1,
        },
      },
    },
  });
  await prisma.resourceAllocation.create({
    data: {
      id: ids.foreignAllocation,
      requestId: ids.foreignRequest,
      officerId: seedIds.districtOfficer,
      idempotencyKey: "da000000-0000-4000-8000-000000000002",
      createdAt: new Date("2026-09-25T12:00:00.000Z"),
    },
  });
  await prisma.transportDispatch.create({
    data: {
      id: ids.foreignDispatch,
      allocationId: ids.foreignAllocation,
      rescueTeamId: seedIds.team,
      destinationLocationId: seedIds.shelterLocation,
      dispatchedAt: new Date("2026-09-25T12:00:00.000Z"),
    },
  });
  await prisma.rescueTeam.update({
    where: { id: seedIds.team },
    data: { status: RescueTeamStatus.AVAILABLE },
  });
}

describeIntegration("deterministic seed reconciliation against isolated PostgreSQL", () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    await cleanupFixtures();
    await seed(prisma);
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
  });

  it("seeds a fresh baseline that passes exact verification", async () => {
    await expect(verifySeed(prisma)).resolves.toMatchObject({ users: expect.any(Number) });
  });

  it("is repeatable when run twice", async () => {
    await seed(prisma);
    await expect(verifySeed(prisma)).resolves.toMatchObject({ activePartner: true });
  });

  it("removes a stale VERIFIED decision from the pending FLOOD report", async () => {
    await prisma.hazardReport.update({
      where: { id: seedIds.pendingReport },
      data: { status: ReportStatus.VERIFIED },
    });
    await prisma.verificationDecision.create({
      data: {
        id: ids.pendingDecision,
        reportId: seedIds.pendingReport,
        officerId: seedIds.dmcOfficer,
        result: VerificationResult.VERIFIED,
        reason: null,
        decidedAt: new Date("2026-09-25T11:00:00.000Z"),
      },
    });
    await seed(prisma);
    await expect(verifySeed(prisma)).resolves.toBeDefined();
  });

  it("removes a stale REJECTED decision and restores the pending baseline", async () => {
    await prisma.hazardReport.update({
      where: { id: seedIds.pendingReport },
      data: { status: ReportStatus.REJECTED },
    });
    await prisma.verificationDecision.create({
      data: {
        id: ids.rejectedDecision,
        reportId: seedIds.pendingReport,
        officerId: seedIds.dmcOfficer,
        result: VerificationResult.REJECTED,
        reason: "Temporary integration rejection.",
        decidedAt: new Date("2026-09-25T11:00:00.000Z"),
      },
    });
    await seed(prisma);
    await expect(verifySeed(prisma)).resolves.toBeDefined();
  });

  it("removes runtime alert descendants while preserving seeded alerts", async () => {
    await prisma.alert.create({
      data: {
        id: ids.runtimeAlert,
        sourceReportId: seedIds.pendingReport,
        createdByOfficerId: seedIds.broadcaster,
        hazardType: HazardType.FLOOD,
        severity: AlertSeverity.ADVISORY,
        message: "Runtime flood draft",
        safetyInstructions: "Follow official instructions.",
        status: AlertStatus.DRAFT,
        version: 1,
      },
    });
    await prisma.alert.create({
      data: {
        id: ids.runtimeReplacement,
        sourceReportId: seedIds.pendingReport,
        createdByOfficerId: seedIds.broadcaster,
        hazardType: HazardType.FLOOD,
        severity: AlertSeverity.ADVISORY,
        message: "Runtime replacement draft",
        safetyInstructions: "Follow official instructions.",
        status: AlertStatus.DRAFT,
        version: 1,
        parentAlertId: ids.runtimeAlert,
      },
    });
    await prisma.alertTargetZone.create({
      data: { alertId: ids.runtimeReplacement, targetZoneId: seedIds.criticalZone },
    });
    await prisma.notificationDelivery.create({
      data: {
        id: ids.runtimeDelivery,
        alertId: ids.runtimeReplacement,
        recipientRef: "runtime-recipient",
        status: DeliveryStatus.PENDING,
        attemptNo: 0,
        updatedAt: new Date("2026-09-25T11:00:00.000Z"),
      },
    });
    await prisma.broadcastAudit.create({
      data: {
        id: ids.runtimeAudit,
        alertId: ids.runtimeReplacement,
        officerId: seedIds.broadcaster,
        action: "CREATED",
        createdAt: new Date("2026-09-25T11:00:00.000Z"),
      },
    });
    await seed(prisma);
    await expect(prisma.alert.findUnique({ where: { id: ids.runtimeAlert } })).resolves.toBeNull();
    await expect(
      prisma.alert.findUnique({ where: { id: seedIds.draftAlert } }),
    ).resolves.toMatchObject({ status: AlertStatus.DRAFT });
    await expect(
      prisma.alert.findUnique({ where: { id: seedIds.activeAlert } }),
    ).resolves.toMatchObject({ status: AlertStatus.ACTIVE });
  });

  it("restores stock, request, allocation, resupply and dispatch baseline", async () => {
    await createResettableAllocation();
    await seed(prisma);
    await expect(verifySeed(prisma)).resolves.toBeDefined();
  });

  it("preserves unrelated report, alert and relief request data", async () => {
    await prisma.hazardReport.create({
      data: {
        id: ids.unrelatedReport,
        clientReportId: ids.unrelatedClientReport,
        reporterId: seedIds.citizen,
        hazardType: HazardType.DROUGHT,
        description: "Unrelated runtime report",
        photoRef: "runtime://unrelated-photo",
        locationId: seedIds.hazardLocation,
        submittedAt: new Date("2026-09-25T13:00:00.000Z"),
        status: ReportStatus.PENDING,
        outsideAssignedArea: false,
        requiresExtraReview: false,
      },
    });
    await prisma.alert.create({
      data: {
        id: ids.unrelatedAlert,
        sourceReportId: ids.unrelatedReport,
        createdByOfficerId: seedIds.broadcaster,
        hazardType: HazardType.DROUGHT,
        severity: AlertSeverity.ADVISORY,
        message: "Unrelated runtime alert",
        safetyInstructions: "Follow official instructions.",
        status: AlertStatus.DRAFT,
        version: 1,
      },
    });
    await prisma.reliefRequest.create({
      data: {
        id: ids.unrelatedRequest,
        shelterId: seedIds.shelter,
        targetZoneId: seedIds.highZone,
        status: ReliefRequestStatus.AWAITING_ALLOCATION,
        priorityNote: "Unrelated runtime request",
        createdAt: new Date("2026-09-25T13:00:00.000Z"),
        version: 1,
        items: {
          create: { id: ids.unrelatedRequestItem, supplyType: SupplyType.TENT, requestedQty: 1 },
        },
      },
    });
    await seed(prisma);
    await expect(
      prisma.hazardReport.findUnique({ where: { id: ids.unrelatedReport } }),
    ).resolves.toMatchObject({ id: ids.unrelatedReport });
    await expect(
      prisma.alert.findUnique({ where: { id: ids.unrelatedAlert } }),
    ).resolves.toMatchObject({ id: ids.unrelatedAlert });
    await expect(
      prisma.reliefRequest.findUnique({ where: { id: ids.unrelatedRequest } }),
    ).resolves.toMatchObject({ id: ids.unrelatedRequest });
  });

  it("fails verification for PENDING plus VerificationDecision", async () => {
    await prisma.verificationDecision.create({
      data: {
        id: ids.verificationDecision,
        reportId: seedIds.pendingReport,
        officerId: seedIds.dmcOfficer,
        result: VerificationResult.VERIFIED,
        reason: null,
        decidedAt: new Date("2026-09-25T11:00:00.000Z"),
      },
    });
    await expect(verifySeed(prisma)).rejects.toThrow("PENDING FLOOD decision presence");
  });

  it("fails verification for an AVAILABLE team with a dispatch", async () => {
    await createResettableAllocation();
    await prisma.rescueTeam.update({
      where: { id: seedIds.team },
      data: { status: RescueTeamStatus.AVAILABLE },
    });
    await expect(verifySeed(prisma)).rejects.toThrow("seeded rescue team dispatch count");
  });

  it("repairs inconsistent resettable states and passes verification", async () => {
    await createResettableAllocation();
    await prisma.hazardReport.update({
      where: { id: seedIds.pendingReport },
      data: { status: ReportStatus.REJECTED },
    });
    await prisma.verificationDecision.create({
      data: {
        id: ids.rejectedDecision,
        reportId: seedIds.pendingReport,
        officerId: seedIds.dmcOfficer,
        result: VerificationResult.REJECTED,
        reason: "Temporary inconsistency.",
        decidedAt: new Date("2026-09-25T11:00:00.000Z"),
      },
    });
    await seed(prisma);
    await expect(verifySeed(prisma)).resolves.toBeDefined();
  });

  it("aborts without mutation when a foreign request dispatch uses the seeded team", async () => {
    await createForeignDispatch();
    await expect(seed(prisma)).rejects.toThrow("non-resettable relief request");
    await expect(
      prisma.transportDispatch.findUnique({ where: { id: ids.foreignDispatch } }),
    ).resolves.toMatchObject({ id: ids.foreignDispatch });
    await expect(
      prisma.rescueTeam.findUnique({ where: { id: seedIds.team } }),
    ).resolves.toMatchObject({ status: RescueTeamStatus.AVAILABLE });
  });
});

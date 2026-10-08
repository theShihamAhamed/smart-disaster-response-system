import {
  AlertStatus,
  DeliveryStatus,
  ReportStatus,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  VerificationResult,
  ZoneSeverity,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { seedIds } from "./seed.js";

const fixedTime = new Date("2026-09-25T10:00:00.000Z");
const deterministicReportIds = [
  seedIds.pendingReport,
  seedIds.verifiedDraftReport,
  seedIds.rejectedReport,
  seedIds.verifiedActiveReport,
] as const;
const resettableRequestIds = [seedIds.fullRequest, seedIds.partialRequest] as const;

function fail(message: string): never {
  throw new Error(`Seed invariant failed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    fail(`${message}; expected ${String(expected)} but found ${String(actual)}.`);
  }
}

function assertDate(actual: Date, expected: Date, message: string): void {
  assertEqual(actual.getTime(), expected.getTime(), message);
}

export async function verifySeed(client: PrismaClient): Promise<Record<string, unknown>> {
  const [
    users,
    pending,
    verified,
    rejected,
    criticalZones,
    draftAlerts,
    activeAlerts,
    requests,
    availableTeams,
  ] = await Promise.all([
    client.user.count(),
    client.hazardReport.count({ where: { status: ReportStatus.PENDING } }),
    client.hazardReport.count({
      where: { status: ReportStatus.VERIFIED, verificationDecision: { isNot: null } },
    }),
    client.hazardReport.count({
      where: { status: ReportStatus.REJECTED, verificationDecision: { isNot: null } },
    }),
    client.targetZone.count({ where: { severity: ZoneSeverity.CRITICAL } }),
    client.alert.count({ where: { status: AlertStatus.DRAFT } }),
    client.alert.count({ where: { status: AlertStatus.ACTIVE, targetZones: { some: {} } } }),
    client.reliefRequest.count(),
    client.rescueTeam.count({ where: { status: RescueTeamStatus.AVAILABLE } }),
  ]);
  const partner = await client.partnerOrganisation.findUnique({ where: { id: seedIds.partner } });
  const checks = {
    users,
    pending,
    verified,
    rejected,
    criticalZones,
    draftAlerts,
    activeAlerts,
    requests,
    availableTeams,
    activePartner: partner?.active === true,
  };

  assert(users >= 5, "expected at least five users");
  assert(pending >= 1, "expected at least one pending report");
  assert(verified >= 2, "expected at least two verified reports with decisions");
  assert(rejected >= 1, "expected at least one rejected report with a decision");
  assert(criticalZones >= 1, "expected at least one critical target zone");
  assert(draftAlerts >= 1, "expected at least one draft alert");
  assert(activeAlerts >= 1, "expected at least one active alert with a target zone");
  assert(requests >= 2, "expected at least two relief requests");
  assert(availableTeams >= 1, "expected at least one available rescue team");
  assert(checks.activePartner, "seeded partner must be active");

  const team = await client.rescueTeam.findUnique({
    where: { id: seedIds.team },
    include: { dispatches: { select: { id: true } } },
  });
  assert(team, "seeded rescue team must exist");
  assertEqual(team.status, RescueTeamStatus.AVAILABLE, "seeded rescue team status");
  assertEqual(team.version, 1, "seeded rescue team version");
  assertEqual(team.dispatches.length, 0, "seeded rescue team dispatch count");

  const reports = await client.hazardReport.findMany({
    where: { id: { in: [...deterministicReportIds] } },
    select: {
      id: true,
      status: true,
      alerts: { select: { id: true } },
      verificationDecision: {
        select: {
          id: true,
          reportId: true,
          officerId: true,
          result: true,
          reason: true,
          decidedAt: true,
        },
      },
    },
  });
  const reportsById = new Map(reports.map((report) => [report.id, report] as const));
  assertEqual(
    reports.length,
    deterministicReportIds.length,
    "all deterministic hazard reports must exist",
  );

  const pendingReport = reportsById.get(seedIds.pendingReport);
  assert(pendingReport, "seeded PENDING FLOOD report must exist");
  assertEqual(pendingReport.status, ReportStatus.PENDING, "PENDING FLOOD report status");
  assertEqual(pendingReport.verificationDecision, null, "PENDING FLOOD decision presence");
  assertEqual(pendingReport.alerts.length, 0, "PENDING FLOOD runtime alert count");

  const expectedDecisions = [
    {
      reportId: seedIds.verifiedDraftReport,
      id: "42000000-0000-4000-8000-000000000001",
      result: VerificationResult.VERIFIED,
      reason: null,
    },
    {
      reportId: seedIds.rejectedReport,
      id: "42000000-0000-4000-8000-000000000002",
      result: VerificationResult.REJECTED,
      reason: "Photo shows ordinary drainage water, not a flood.",
    },
    {
      reportId: seedIds.verifiedActiveReport,
      id: "42000000-0000-4000-8000-000000000003",
      result: VerificationResult.VERIFIED,
      reason: "Evidence corroborated by field volunteer.",
    },
  ] as const;
  for (const expected of expectedDecisions) {
    const report = reportsById.get(expected.reportId);
    assert(report, `deterministic report ${expected.reportId} must exist`);
    assertEqual(
      report.status,
      expected.result === VerificationResult.REJECTED
        ? ReportStatus.REJECTED
        : ReportStatus.VERIFIED,
      `${expected.reportId} status`,
    );
    assert(report.verificationDecision, `${expected.reportId} decision presence`);
    assertEqual(report.verificationDecision.id, expected.id, `${expected.reportId} decision id`);
    assertEqual(
      report.verificationDecision.reportId,
      expected.reportId,
      `${expected.reportId} decision reportId`,
    );
    assertEqual(
      report.verificationDecision.officerId,
      seedIds.dmcOfficer,
      `${expected.reportId} decision officerId`,
    );
    assertEqual(
      report.verificationDecision.result,
      expected.result,
      `${expected.reportId} decision result`,
    );
    assertEqual(
      report.verificationDecision.reason,
      expected.reason,
      `${expected.reportId} decision reason`,
    );
    assertDate(
      report.verificationDecision.decidedAt,
      fixedTime,
      `${expected.reportId} decision timestamp`,
    );
  }

  const [draftAlert, activeAlert] = await Promise.all([
    client.alert.findUnique({
      where: { id: seedIds.draftAlert },
      include: { targetZones: true, deliveries: true, audits: true },
    }),
    client.alert.findUnique({
      where: { id: seedIds.activeAlert },
      include: { targetZones: true, deliveries: true, audits: true },
    }),
  ]);
  assert(draftAlert, "seeded draft alert must exist");
  assertEqual(draftAlert.status, AlertStatus.DRAFT, "seeded draft alert status");
  assertEqual(
    draftAlert.sourceReportId,
    seedIds.verifiedDraftReport,
    "seeded draft alert sourceReportId",
  );
  assertEqual(draftAlert.targetZones.length, 0, "seeded draft alert target-zone count");
  assertEqual(draftAlert.deliveries.length, 0, "seeded draft alert delivery count");
  assertEqual(draftAlert.audits.length, 0, "seeded draft alert audit count");

  assert(activeAlert, "seeded active alert must exist");
  assertEqual(activeAlert.status, AlertStatus.ACTIVE, "seeded active alert status");
  assertEqual(
    activeAlert.sourceReportId,
    seedIds.verifiedActiveReport,
    "seeded active alert sourceReportId",
  );
  assertEqual(activeAlert.targetZones.length, 1, "seeded active alert target-zone count");
  assertEqual(
    activeAlert.targetZones[0]?.targetZoneId,
    seedIds.criticalZone,
    "seeded active alert target zone",
  );
  assertEqual(activeAlert.deliveries.length, 1, "seeded active alert delivery count");
  assertEqual(
    activeAlert.deliveries[0]?.id,
    "51000000-0000-4000-8000-000000000001",
    "seeded delivery id",
  );
  assertEqual(activeAlert.deliveries[0]?.alertId, seedIds.activeAlert, "seeded delivery alertId");
  assertEqual(
    activeAlert.deliveries[0]?.status,
    DeliveryStatus.PUSH_SENT,
    "seeded delivery status",
  );
  assertEqual(activeAlert.deliveries[0]?.attemptNo, 1, "seeded delivery attemptNo");
  assertDate(
    activeAlert.deliveries[0]?.updatedAt ?? new Date(0),
    fixedTime,
    "seeded delivery timestamp",
  );
  assertEqual(activeAlert.audits.length, 1, "seeded active alert audit count");
  assertEqual(activeAlert.audits[0]?.id, "52000000-0000-4000-8000-000000000001", "seeded audit id");
  assertEqual(activeAlert.audits[0]?.action, "ACTIVATED", "seeded audit action");
  assertDate(activeAlert.audits[0]?.createdAt ?? new Date(0), fixedTime, "seeded audit timestamp");

  const expectedRequests = [
    {
      id: seedIds.fullRequest,
      status: ReliefRequestStatus.AWAITING_ALLOCATION,
      version: 1,
      items: [
        [SupplyType.WATER, 100],
        [SupplyType.DRY_RATIONS, 50],
      ],
    },
    {
      id: seedIds.partialRequest,
      status: ReliefRequestStatus.AWAITING_ALLOCATION,
      version: 1,
      items: [
        [SupplyType.WATER, 100],
        [SupplyType.MEDICAL_KIT, 20],
      ],
    },
  ] as const;
  const requestsById = new Map(
    (
      await client.reliefRequest.findMany({
        where: { id: { in: [...resettableRequestIds] } },
        include: { items: true },
      })
    ).map((request) => [request.id, request] as const),
  );
  for (const expected of expectedRequests) {
    const request = requestsById.get(expected.id);
    assert(request, `deterministic relief request ${expected.id} must exist`);
    assertEqual(request.status, expected.status, `${expected.id} status`);
    assertEqual(request.version, expected.version, `${expected.id} version`);
    assertEqual(request.items.length, expected.items.length, `${expected.id} item count`);
    for (const [supplyType, requestedQty] of expected.items) {
      const item = request.items.find((candidate) => candidate.supplyType === supplyType);
      assert(item, `${expected.id} ${supplyType} item must exist`);
      assertEqual(
        item.requestedQty,
        requestedQty,
        `${expected.id} ${supplyType} requested quantity`,
      );
    }
  }

  const expectedStock = new Map([
    [SupplyType.WATER, [300, 1]],
    [SupplyType.DRY_RATIONS, [150, 1]],
    [SupplyType.MEDICAL_KIT, [8, 1]],
    [SupplyType.TENT, [40, 1]],
  ] as const);
  const stock = await client.warehouseStock.findMany({ where: { districtId: seedIds.district } });
  for (const [supplyType, [availableQty, version]] of expectedStock) {
    const row = stock.find((candidate) => candidate.supplyType === supplyType);
    assert(row, `${supplyType} stock row must exist`);
    assertEqual(row.availableQty, availableQty, `${supplyType} stock quantity`);
    assertEqual(row.version, version, `${supplyType} stock version`);
  }

  const allocations = await client.resourceAllocation.findMany({
    where: { requestId: { in: [...resettableRequestIds] } },
    select: { id: true },
  });
  assertEqual(allocations.length, 0, "resettable request allocation count");
  const allocationIds = allocations.map(({ id }) => id);
  assertEqual(
    await client.allocationItem.count({ where: { allocationId: { in: allocationIds } } }),
    0,
    "resettable allocation-item count",
  );
  assertEqual(
    await client.distributionLog.count({ where: { allocationId: { in: allocationIds } } }),
    0,
    "resettable distribution-log count",
  );
  assertEqual(
    await client.partnerResupplyRequest.count({
      where: { reliefRequestId: { in: [...resettableRequestIds] } },
    }),
    0,
    "resettable partner-resupply count",
  );
  assertEqual(
    await client.transportDispatch.count({ where: { allocationId: { in: allocationIds } } }),
    0,
    "resettable transport-dispatch count",
  );

  assertEqual(partner?.active, true, "seeded partner active state");

  const shelter = await client.shelter.findUnique({ where: { id: seedIds.shelter } });
  assert(shelter, "seeded shelter must exist");
  assertEqual(shelter.capacity, 250, "seeded shelter capacity");
  assertEqual(shelter.currentOccupancy, 180, "seeded shelter occupancy");

  return checks;
}

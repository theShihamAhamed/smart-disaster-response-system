import {
  AlertSeverity,
  AlertStatus,
  DeliveryStatus,
  HazardType,
  LocationSource,
  PartnerOrganisationType,
  PrismaClient,
  ReliefRequestStatus,
  ReportStatus,
  RescueTeamStatus,
  SupplyType,
  UserRole,
  VerificationResult,
  ZoneSeverity,
} from "@prisma/client";

const prisma = new PrismaClient();

export const seedIds = {
  district: "00000000-0000-4000-8000-000000000001",
  assignedArea: "00000000-0000-4000-8000-000000000002",
  citizen: "10000000-0000-4000-8000-000000000001",
  volunteer: "10000000-0000-4000-8000-000000000002",
  dmcOfficer: "10000000-0000-4000-8000-000000000003",
  broadcaster: "10000000-0000-4000-8000-000000000004",
  districtOfficer: "10000000-0000-4000-8000-000000000005",
  hazardLocation: "20000000-0000-4000-8000-000000000001",
  shelterLocation: "20000000-0000-4000-8000-000000000002",
  teamLocation: "20000000-0000-4000-8000-000000000003",
  criticalZone: "30000000-0000-4000-8000-000000000001",
  highZone: "30000000-0000-4000-8000-000000000002",
  pendingReport: "40000000-0000-4000-8000-000000000001",
  verifiedDraftReport: "40000000-0000-4000-8000-000000000002",
  rejectedReport: "40000000-0000-4000-8000-000000000003",
  verifiedActiveReport: "40000000-0000-4000-8000-000000000004",
  draftAlert: "50000000-0000-4000-8000-000000000001",
  activeAlert: "50000000-0000-4000-8000-000000000002",
  shelter: "60000000-0000-4000-8000-000000000001",
  fullRequest: "70000000-0000-4000-8000-000000000001",
  partialRequest: "70000000-0000-4000-8000-000000000002",
  partner: "80000000-0000-4000-8000-000000000001",
  team: "90000000-0000-4000-8000-000000000001",
} as const;

const fixedTime = new Date("2026-09-25T10:00:00.000Z");

async function seed() {
  await prisma.$transaction(
    async (tx) => {
      const users = [
        {
          id: seedIds.citizen,
          name: "Demo Citizen",
          contactNo: "+94770000001",
          role: UserRole.CITIZEN,
        },
        {
          id: seedIds.volunteer,
          name: "Demo Volunteer",
          contactNo: "+94770000002",
          role: UserRole.VOLUNTEER,
        },
        {
          id: seedIds.dmcOfficer,
          name: "DMC Duty Officer",
          contactNo: "+94770000003",
          role: UserRole.DMC_DUTY_OFFICER,
        },
        {
          id: seedIds.broadcaster,
          name: "DMC Broadcast Officer",
          contactNo: "+94770000004",
          role: UserRole.DMC_DUTY_OFFICER,
        },
        {
          id: seedIds.districtOfficer,
          name: "District Officer",
          contactNo: "+94770000005",
          role: UserRole.DISTRICT_OFFICER,
        },
      ];
      for (const user of users) {
        await tx.user.upsert({ where: { id: user.id }, update: user, create: user });
      }

      await tx.volunteer.upsert({
        where: { userId: seedIds.volunteer },
        update: { assignedAreaId: seedIds.assignedArea },
        create: { userId: seedIds.volunteer, assignedAreaId: seedIds.assignedArea },
      });
      for (const officer of [
        { userId: seedIds.dmcOfficer, dutyStation: "National DMC", canBroadcast: false },
        { userId: seedIds.broadcaster, dutyStation: "National DMC", canBroadcast: true },
      ]) {
        await tx.dmcOfficer.upsert({
          where: { userId: officer.userId },
          update: officer,
          create: officer,
        });
      }
      await tx.districtOfficer.upsert({
        where: { userId: seedIds.districtOfficer },
        update: { districtId: seedIds.district },
        create: { userId: seedIds.districtOfficer, districtId: seedIds.district },
      });

      const locations = [
        {
          id: seedIds.hazardLocation,
          latitude: 6.9271,
          longitude: 79.8612,
          districtId: seedIds.district,
          address: "Colombo hazard point",
          source: LocationSource.GPS,
        },
        {
          id: seedIds.shelterLocation,
          latitude: 6.935,
          longitude: 79.85,
          districtId: seedIds.district,
          address: "Central relief shelter",
          source: LocationSource.MANUAL,
        },
        {
          id: seedIds.teamLocation,
          latitude: 6.92,
          longitude: 79.87,
          districtId: seedIds.district,
          address: "District response base",
          source: LocationSource.GPS,
        },
      ];
      for (const location of locations) {
        await tx.location.upsert({
          where: { id: location.id },
          update: location,
          create: location,
        });
      }

      const zones = [
        {
          id: seedIds.criticalZone,
          name: "Colombo Critical Flood Zone",
          districtId: seedIds.district,
          severity: ZoneSeverity.CRITICAL,
          geometryRef: "geo:colombo-critical-v1",
        },
        {
          id: seedIds.highZone,
          name: "Colombo High Risk Zone",
          districtId: seedIds.district,
          severity: ZoneSeverity.HIGH,
          geometryRef: "geo:colombo-high-v1",
        },
      ];
      for (const zone of zones) {
        await tx.targetZone.upsert({ where: { id: zone.id }, update: zone, create: zone });
      }

      const reports = [
        {
          id: seedIds.pendingReport,
          clientReportId: "41000000-0000-4000-8000-000000000001",
          reporterId: seedIds.citizen,
          hazardType: HazardType.FLOOD,
          description: "Flood water is crossing the main road.",
          photoRef: "seed://photos/pending-flood.jpg",
          locationId: seedIds.hazardLocation,
          submittedAt: fixedTime,
          status: ReportStatus.PENDING,
          outsideAssignedArea: false,
          requiresExtraReview: false,
        },
        {
          id: seedIds.verifiedDraftReport,
          clientReportId: "41000000-0000-4000-8000-000000000002",
          reporterId: seedIds.volunteer,
          hazardType: HazardType.LANDSLIDE,
          description: "Fresh soil movement is visible above the village road.",
          photoRef: "seed://photos/verified-landslide.jpg",
          locationId: seedIds.hazardLocation,
          submittedAt: fixedTime,
          status: ReportStatus.VERIFIED,
          outsideAssignedArea: false,
          requiresExtraReview: false,
        },
        {
          id: seedIds.rejectedReport,
          clientReportId: "41000000-0000-4000-8000-000000000003",
          reporterId: seedIds.citizen,
          hazardType: HazardType.FLOOD,
          description: "Standing water reported beside the market entrance.",
          photoRef: "seed://photos/rejected-water.jpg",
          locationId: seedIds.hazardLocation,
          submittedAt: fixedTime,
          status: ReportStatus.REJECTED,
          outsideAssignedArea: false,
          requiresExtraReview: false,
        },
        {
          id: seedIds.verifiedActiveReport,
          clientReportId: "41000000-0000-4000-8000-000000000004",
          reporterId: seedIds.volunteer,
          hazardType: HazardType.CYCLONE,
          description: "Severe winds are damaging roofs near the coastal road.",
          photoRef: "seed://photos/verified-cyclone.jpg",
          locationId: seedIds.hazardLocation,
          submittedAt: fixedTime,
          status: ReportStatus.VERIFIED,
          outsideAssignedArea: true,
          requiresExtraReview: true,
        },
      ];
      for (const report of reports) {
        await tx.hazardReport.upsert({ where: { id: report.id }, update: report, create: report });
      }

      const decisions = [
        {
          id: "42000000-0000-4000-8000-000000000001",
          reportId: seedIds.verifiedDraftReport,
          officerId: seedIds.dmcOfficer,
          result: VerificationResult.VERIFIED,
          reason: null,
          decidedAt: fixedTime,
        },
        {
          id: "42000000-0000-4000-8000-000000000002",
          reportId: seedIds.rejectedReport,
          officerId: seedIds.dmcOfficer,
          result: VerificationResult.REJECTED,
          reason: "Photo shows ordinary drainage water, not a flood.",
          decidedAt: fixedTime,
        },
        {
          id: "42000000-0000-4000-8000-000000000003",
          reportId: seedIds.verifiedActiveReport,
          officerId: seedIds.dmcOfficer,
          result: VerificationResult.VERIFIED,
          reason: "Evidence corroborated by field volunteer.",
          decidedAt: fixedTime,
        },
      ];
      for (const decision of decisions) {
        await tx.verificationDecision.upsert({
          where: { reportId: decision.reportId },
          update: decision,
          create: decision,
        });
      }

      await tx.alert.upsert({
        where: { id: seedIds.draftAlert },
        update: {},
        create: {
          id: seedIds.draftAlert,
          sourceReportId: seedIds.verifiedDraftReport,
          createdByOfficerId: seedIds.broadcaster,
          hazardType: HazardType.LANDSLIDE,
          severity: AlertSeverity.WARNING,
          message: "Draft landslide warning for review.",
          safetyInstructions: "Avoid the hillside road and await official instructions.",
          status: AlertStatus.DRAFT,
          version: 1,
        },
      });
      await tx.alert.upsert({
        where: { id: seedIds.activeAlert },
        update: {},
        create: {
          id: seedIds.activeAlert,
          sourceReportId: seedIds.verifiedActiveReport,
          createdByOfficerId: seedIds.broadcaster,
          hazardType: HazardType.CYCLONE,
          severity: AlertSeverity.EVACUATION,
          message: "Cyclone warning is active for the coastal target zone.",
          safetyInstructions: "Move to the nearest designated shelter immediately.",
          status: AlertStatus.ACTIVE,
          version: 1,
          issuedAt: fixedTime,
        },
      });
      await tx.alertTargetZone.upsert({
        where: {
          alertId_targetZoneId: {
            alertId: seedIds.activeAlert,
            targetZoneId: seedIds.criticalZone,
          },
        },
        update: {},
        create: { alertId: seedIds.activeAlert, targetZoneId: seedIds.criticalZone },
      });
      await tx.notificationDelivery.upsert({
        where: { id: "51000000-0000-4000-8000-000000000001" },
        update: {},
        create: {
          id: "51000000-0000-4000-8000-000000000001",
          alertId: seedIds.activeAlert,
          recipientRef: "seed-recipient-001",
          status: DeliveryStatus.PUSH_SENT,
          attemptNo: 1,
          updatedAt: fixedTime,
        },
      });
      await tx.broadcastAudit.upsert({
        where: { id: "52000000-0000-4000-8000-000000000001" },
        update: {},
        create: {
          id: "52000000-0000-4000-8000-000000000001",
          alertId: seedIds.activeAlert,
          officerId: seedIds.broadcaster,
          action: "ACTIVATED",
          createdAt: fixedTime,
        },
      });

      await tx.shelter.upsert({
        where: { id: seedIds.shelter },
        update: {},
        create: {
          id: seedIds.shelter,
          name: "Colombo Central Shelter",
          districtId: seedIds.district,
          locationId: seedIds.shelterLocation,
          capacity: 250,
          currentOccupancy: 180,
        },
      });
      for (const request of [
        {
          id: seedIds.fullRequest,
          shelterId: seedIds.shelter,
          targetZoneId: seedIds.highZone,
          status: ReliefRequestStatus.AWAITING_ALLOCATION,
          priorityNote: "All requested stock is available.",
          createdAt: fixedTime,
          version: 1,
        },
        {
          id: seedIds.partialRequest,
          shelterId: seedIds.shelter,
          targetZoneId: seedIds.criticalZone,
          status: ReliefRequestStatus.AWAITING_ALLOCATION,
          priorityNote: "Medical kits exceed current stock.",
          createdAt: new Date("2026-09-25T10:05:00.000Z"),
          version: 1,
        },
      ]) {
        await tx.reliefRequest.upsert({
          where: { id: request.id },
          update: request,
          create: request,
        });
      }
      const requestItems = [
        {
          id: "71000000-0000-4000-8000-000000000001",
          requestId: seedIds.fullRequest,
          supplyType: SupplyType.WATER,
          requestedQty: 100,
        },
        {
          id: "71000000-0000-4000-8000-000000000002",
          requestId: seedIds.fullRequest,
          supplyType: SupplyType.DRY_RATIONS,
          requestedQty: 50,
        },
        {
          id: "71000000-0000-4000-8000-000000000003",
          requestId: seedIds.partialRequest,
          supplyType: SupplyType.WATER,
          requestedQty: 100,
        },
        {
          id: "71000000-0000-4000-8000-000000000004",
          requestId: seedIds.partialRequest,
          supplyType: SupplyType.MEDICAL_KIT,
          requestedQty: 20,
        },
      ];
      for (const item of requestItems) {
        await tx.reliefRequestItem.upsert({ where: { id: item.id }, update: item, create: item });
      }
      const stock = [
        {
          id: "72000000-0000-4000-8000-000000000001",
          districtId: seedIds.district,
          supplyType: SupplyType.WATER,
          availableQty: 300,
          version: 1,
          syncedAt: fixedTime,
        },
        {
          id: "72000000-0000-4000-8000-000000000002",
          districtId: seedIds.district,
          supplyType: SupplyType.DRY_RATIONS,
          availableQty: 150,
          version: 1,
          syncedAt: fixedTime,
        },
        {
          id: "72000000-0000-4000-8000-000000000003",
          districtId: seedIds.district,
          supplyType: SupplyType.MEDICAL_KIT,
          availableQty: 8,
          version: 1,
          syncedAt: fixedTime,
        },
        {
          id: "72000000-0000-4000-8000-000000000004",
          districtId: seedIds.district,
          supplyType: SupplyType.TENT,
          availableQty: 40,
          version: 1,
          syncedAt: fixedTime,
        },
      ];
      for (const row of stock) {
        await tx.warehouseStock.upsert({
          where: {
            districtId_supplyType: { districtId: row.districtId, supplyType: row.supplyType },
          },
          update: row,
          create: row,
        });
      }
      await tx.partnerOrganisation.upsert({
        where: { id: seedIds.partner },
        update: {},
        create: {
          id: seedIds.partner,
          districtId: seedIds.district,
          name: "Demo Relief NGO",
          type: PartnerOrganisationType.NGO,
          active: true,
        },
      });
      await tx.rescueTeam.upsert({
        where: { id: seedIds.team },
        update: {},
        create: {
          id: seedIds.team,
          districtId: seedIds.district,
          name: "Colombo Rescue Team A",
          status: RescueTeamStatus.AVAILABLE,
          locationId: seedIds.teamLocation,
          version: 1,
        },
      });
    },
    {
      maxWait: 10_000,
      timeout: 60_000,
    },
  );
}

seed()
  .then(() => console.log("Deterministic Phase 1 seed completed."))
  .finally(async () => prisma.$disconnect());

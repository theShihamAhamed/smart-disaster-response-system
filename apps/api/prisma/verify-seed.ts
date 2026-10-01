import {
  AlertStatus,
  PrismaClient,
  ReportStatus,
  RescueTeamStatus,
  ZoneSeverity,
} from "@prisma/client";

const prisma = new PrismaClient();
const partnerId = "80000000-0000-4000-8000-000000000001";

async function verify() {
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
    prisma.user.count(),
    prisma.hazardReport.count({ where: { status: ReportStatus.PENDING } }),
    prisma.hazardReport.count({
      where: { status: ReportStatus.VERIFIED, verificationDecision: { isNot: null } },
    }),
    prisma.hazardReport.count({
      where: { status: ReportStatus.REJECTED, verificationDecision: { isNot: null } },
    }),
    prisma.targetZone.count({ where: { severity: ZoneSeverity.CRITICAL } }),
    prisma.alert.count({ where: { status: AlertStatus.DRAFT } }),
    prisma.alert.count({ where: { status: AlertStatus.ACTIVE, targetZones: { some: {} } } }),
    prisma.reliefRequest.count(),
    prisma.rescueTeam.count({ where: { status: RescueTeamStatus.AVAILABLE } }),
  ]);
  const partner = await prisma.partnerOrganisation.findUnique({ where: { id: partnerId } });
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
  if (
    users < 5 ||
    pending < 1 ||
    verified < 2 ||
    rejected < 1 ||
    criticalZones < 1 ||
    draftAlerts < 1 ||
    activeAlerts < 1 ||
    requests < 2 ||
    availableTeams < 1 ||
    !checks.activePartner
  ) {
    throw new Error(`Seed verification failed: ${JSON.stringify(checks)}`);
  }
  console.log(`Seed verification passed: ${JSON.stringify(checks)}`);
}

verify().finally(async () => prisma.$disconnect());

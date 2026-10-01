-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CITIZEN', 'VOLUNTEER', 'DMC_DUTY_OFFICER', 'DISTRICT_OFFICER');

-- CreateEnum
CREATE TYPE "HazardType" AS ENUM ('FLOOD', 'LANDSLIDE', 'CYCLONE', 'DROUGHT');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('ADVISORY', 'WARNING', 'EVACUATION');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PUSH_SENT', 'PUSH_FAILED', 'SMS_FALLBACK_QUEUED', 'SMS_SENT', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "ReliefRequestStatus" AS ENUM ('AWAITING_ALLOCATION', 'PARTIALLY_ALLOCATED', 'AWAITING_RESUPPLY', 'ALLOCATED');

-- CreateEnum
CREATE TYPE "ZoneSeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('DRY_RATIONS', 'WATER', 'TENT', 'MEDICAL_KIT');

-- CreateEnum
CREATE TYPE "RescueTeamStatus" AS ENUM ('AVAILABLE', 'EN_ROUTE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "PartnerOrganisationType" AS ENUM ('NGO', 'ARMED_FORCES', 'PRIVATE_DONOR');

-- CreateEnum
CREATE TYPE "PartnerResupplyStatus" AS ENUM ('REQUESTED', 'ACKNOWLEDGED', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactNo" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Volunteer" (
    "userId" UUID NOT NULL,
    "assignedAreaId" UUID NOT NULL,

    CONSTRAINT "Volunteer_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DmcOfficer" (
    "userId" UUID NOT NULL,
    "dutyStation" TEXT NOT NULL,
    "canBroadcast" BOOLEAN NOT NULL,

    CONSTRAINT "DmcOfficer_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DistrictOfficer" (
    "userId" UUID NOT NULL,
    "districtId" UUID NOT NULL,

    CONSTRAINT "DistrictOfficer_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "districtId" UUID NOT NULL,
    "address" TEXT,
    "source" "LocationSource" NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetZone" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" UUID NOT NULL,
    "severity" "ZoneSeverity" NOT NULL,
    "geometryRef" TEXT NOT NULL,

    CONSTRAINT "TargetZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HazardReport" (
    "id" UUID NOT NULL,
    "clientReportId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "hazardType" "HazardType" NOT NULL,
    "description" TEXT NOT NULL,
    "photoRef" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReportStatus" NOT NULL,
    "outsideAssignedArea" BOOLEAN NOT NULL,
    "requiresExtraReview" BOOLEAN NOT NULL,

    CONSTRAINT "HazardReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDecision" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "officerId" UUID NOT NULL,
    "result" "VerificationResult" NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VerificationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "sourceReportId" UUID NOT NULL,
    "createdByOfficerId" UUID NOT NULL,
    "hazardType" "HazardType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "safetyInstructions" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL,
    "version" INTEGER NOT NULL,
    "parentAlertId" UUID,
    "issuedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertTargetZone" (
    "alertId" UUID NOT NULL,
    "targetZoneId" UUID NOT NULL,

    CONSTRAINT "AlertTargetZone_pkey" PRIMARY KEY ("alertId","targetZoneId")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "recipientRef" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "lastFailureReason" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastAudit" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "officerId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BroadcastAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shelter" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "capacity" INTEGER NOT NULL,
    "currentOccupancy" INTEGER NOT NULL,

    CONSTRAINT "Shelter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReliefRequest" (
    "id" UUID NOT NULL,
    "shelterId" UUID NOT NULL,
    "targetZoneId" UUID NOT NULL,
    "status" "ReliefRequestStatus" NOT NULL,
    "priorityNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "ReliefRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReliefRequestItem" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "supplyType" "SupplyType" NOT NULL,
    "requestedQty" INTEGER NOT NULL,

    CONSTRAINT "ReliefRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseStock" (
    "id" UUID NOT NULL,
    "districtId" UUID NOT NULL,
    "supplyType" "SupplyType" NOT NULL,
    "availableQty" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceAllocation" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "officerId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ResourceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationItem" (
    "id" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "requestItemId" UUID NOT NULL,
    "supplyType" "SupplyType" NOT NULL,
    "allocatedQty" INTEGER NOT NULL,

    CONSTRAINT "AllocationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionLog" (
    "id" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "allocationItemId" UUID NOT NULL,
    "districtId" UUID NOT NULL,
    "supplyType" "SupplyType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DistributionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerOrganisation" (
    "id" UUID NOT NULL,
    "districtId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartnerOrganisationType" NOT NULL,
    "active" BOOLEAN NOT NULL,

    CONSTRAINT "PartnerOrganisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerResupplyRequest" (
    "id" UUID NOT NULL,
    "reliefRequestId" UUID NOT NULL,
    "partnerOrganisationId" UUID NOT NULL,
    "supplyType" "SupplyType" NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "status" "PartnerResupplyStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PartnerResupplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RescueTeam" (
    "id" UUID NOT NULL,
    "districtId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RescueTeamStatus" NOT NULL,
    "locationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "RescueTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportDispatch" (
    "id" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "rescueTeamId" UUID NOT NULL,
    "destinationLocationId" UUID NOT NULL,
    "dispatchedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TransportDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HazardReport_clientReportId_key" ON "HazardReport"("clientReportId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationDecision_reportId_key" ON "VerificationDecision"("reportId");

-- CreateIndex
CREATE INDEX "Alert_sourceReportId_idx" ON "Alert"("sourceReportId");

-- CreateIndex
CREATE INDEX "Alert_parentAlertId_idx" ON "Alert"("parentAlertId");

-- CreateIndex
CREATE UNIQUE INDEX "ReliefRequestItem_requestId_supplyType_key" ON "ReliefRequestItem"("requestId", "supplyType");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStock_districtId_supplyType_key" ON "WarehouseStock"("districtId", "supplyType");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceAllocation_officerId_idempotencyKey_key" ON "ResourceAllocation"("officerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DistributionLog_allocationItemId_key" ON "DistributionLog"("allocationItemId");

-- CreateIndex
CREATE INDEX "PartnerResupplyRequest_reliefRequestId_partnerOrganisationI_idx" ON "PartnerResupplyRequest"("reliefRequestId", "partnerOrganisationId", "supplyType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransportDispatch_allocationId_key" ON "TransportDispatch"("allocationId");

-- Frozen partial unique indexes that Prisma DSL cannot express.
CREATE UNIQUE INDEX "Alert_sourceReportId_initial_key"
ON "Alert"("sourceReportId")
WHERE "parentAlertId" IS NULL;

CREATE UNIQUE INDEX "PartnerResupplyRequest_active_requested_key"
ON "PartnerResupplyRequest"("reliefRequestId", "partnerOrganisationId", "supplyType")
WHERE "status" = 'REQUESTED';

-- Frozen integrity checks that Prisma DSL cannot express.
ALTER TABLE "AllocationItem"
ADD CONSTRAINT "AllocationItem_allocatedQty_positive" CHECK ("allocatedQty" > 0);

ALTER TABLE "WarehouseStock"
ADD CONSTRAINT "WarehouseStock_availableQty_nonnegative" CHECK ("availableQty" >= 0);

ALTER TABLE "Shelter"
ADD CONSTRAINT "Shelter_capacity_positive" CHECK ("capacity" > 0),
ADD CONSTRAINT "Shelter_currentOccupancy_nonnegative" CHECK ("currentOccupancy" >= 0);

ALTER TABLE "ReliefRequestItem"
ADD CONSTRAINT "ReliefRequestItem_requestedQty_positive" CHECK ("requestedQty" > 0);

ALTER TABLE "PartnerResupplyRequest"
ADD CONSTRAINT "PartnerResupplyRequest_requestedQty_positive" CHECK ("requestedQty" > 0);

ALTER TABLE "VerificationDecision"
ADD CONSTRAINT "VerificationDecision_rejection_reason_required"
CHECK ("result" <> 'REJECTED' OR ("reason" IS NOT NULL AND char_length(btrim("reason")) BETWEEN 10 AND 500));

-- AddForeignKey
ALTER TABLE "Volunteer" ADD CONSTRAINT "Volunteer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmcOfficer" ADD CONSTRAINT "DmcOfficer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistrictOfficer" ADD CONSTRAINT "DistrictOfficer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardReport" ADD CONSTRAINT "HazardReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HazardReport" ADD CONSTRAINT "HazardReport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "HazardReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "DmcOfficer"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_sourceReportId_fkey" FOREIGN KEY ("sourceReportId") REFERENCES "HazardReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_createdByOfficerId_fkey" FOREIGN KEY ("createdByOfficerId") REFERENCES "DmcOfficer"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_parentAlertId_fkey" FOREIGN KEY ("parentAlertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertTargetZone" ADD CONSTRAINT "AlertTargetZone_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertTargetZone" ADD CONSTRAINT "AlertTargetZone_targetZoneId_fkey" FOREIGN KEY ("targetZoneId") REFERENCES "TargetZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastAudit" ADD CONSTRAINT "BroadcastAudit_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastAudit" ADD CONSTRAINT "BroadcastAudit_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "DmcOfficer"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shelter" ADD CONSTRAINT "Shelter_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReliefRequest" ADD CONSTRAINT "ReliefRequest_shelterId_fkey" FOREIGN KEY ("shelterId") REFERENCES "Shelter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReliefRequest" ADD CONSTRAINT "ReliefRequest_targetZoneId_fkey" FOREIGN KEY ("targetZoneId") REFERENCES "TargetZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReliefRequestItem" ADD CONSTRAINT "ReliefRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReliefRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReliefRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "DistrictOfficer"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationItem" ADD CONSTRAINT "AllocationItem_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ResourceAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationItem" ADD CONSTRAINT "AllocationItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "ReliefRequestItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionLog" ADD CONSTRAINT "DistributionLog_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ResourceAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionLog" ADD CONSTRAINT "DistributionLog_allocationItemId_fkey" FOREIGN KEY ("allocationItemId") REFERENCES "AllocationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerResupplyRequest" ADD CONSTRAINT "PartnerResupplyRequest_reliefRequestId_fkey" FOREIGN KEY ("reliefRequestId") REFERENCES "ReliefRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerResupplyRequest" ADD CONSTRAINT "PartnerResupplyRequest_partnerOrganisationId_fkey" FOREIGN KEY ("partnerOrganisationId") REFERENCES "PartnerOrganisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueTeam" ADD CONSTRAINT "RescueTeam_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportDispatch" ADD CONSTRAINT "TransportDispatch_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ResourceAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportDispatch" ADD CONSTRAINT "TransportDispatch_rescueTeamId_fkey" FOREIGN KEY ("rescueTeamId") REFERENCES "RescueTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportDispatch" ADD CONSTRAINT "TransportDispatch_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

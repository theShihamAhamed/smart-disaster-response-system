import {
  PartnerOrganisationType,
  PrismaClient,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  UserRole,
  ZoneSeverity,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaReliefReadRepository } from "./prisma-relief-read-repository.js";

function isIsolatedPostgres(urlValue: string | undefined): boolean {
  if (!urlValue) return false;
  try {
    const url = new URL(urlValue);
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return localHost && url.pathname.toLowerCase().includes("test");
  } catch {
    return false;
  }
}

const integrationRequested = process.env.RUN_RELIEF_DB_INTEGRATION_TESTS === "true";
const isolatedDatabase = isIsolatedPostgres(process.env.DATABASE_URL);
if (integrationRequested && !isolatedDatabase) {
  throw new Error(
    "Relief database integration tests require a localhost PostgreSQL database whose name contains 'test'.",
  );
}

const describeIntegration = integrationRequested && isolatedDatabase ? describe : describe.skip;
let prisma: PrismaClient;

const ids = {
  district: "f0000000-0000-4000-8000-000000000001",
  otherDistrict: "f0000000-0000-4000-8000-000000000002",
  officer: "f1000000-0000-4000-8000-000000000001",
  shelterLocation: "f2000000-0000-4000-8000-000000000001",
  teamLocation: "f2000000-0000-4000-8000-000000000002",
  otherLocation: "f2000000-0000-4000-8000-000000000003",
  zone: "f3000000-0000-4000-8000-000000000001",
  otherZone: "f3000000-0000-4000-8000-000000000002",
  shelter: "f6000000-0000-4000-8000-000000000001",
  otherShelter: "f6000000-0000-4000-8000-000000000002",
  request: "f7000000-0000-4000-8000-000000000001",
  allocatedRequest: "f7000000-0000-4000-8000-000000000002",
  otherRequest: "f7000000-0000-4000-8000-000000000003",
  requestItem: "f7100000-0000-4000-8000-000000000001",
  allocatedRequestItem: "f7100000-0000-4000-8000-000000000002",
  otherRequestItem: "f7100000-0000-4000-8000-000000000003",
  stock: "f7200000-0000-4000-8000-000000000001",
  allocation: "f7300000-0000-4000-8000-000000000001",
  allocationItem: "f7400000-0000-4000-8000-000000000001",
  partner: "f8000000-0000-4000-8000-000000000001",
  inactivePartner: "f8000000-0000-4000-8000-000000000002",
  otherPartner: "f8000000-0000-4000-8000-000000000003",
  team: "f9000000-0000-4000-8000-000000000001",
  enRouteTeam: "f9000000-0000-4000-8000-000000000002",
  otherTeam: "f9000000-0000-4000-8000-000000000003",
} as const;

async function cleanup(): Promise<void> {
  await prisma.$transaction([
    prisma.allocationItem.deleteMany({ where: { id: ids.allocationItem } }),
    prisma.resourceAllocation.deleteMany({ where: { id: ids.allocation } }),
    prisma.reliefRequestItem.deleteMany({
      where: {
        id: { in: [ids.requestItem, ids.allocatedRequestItem, ids.otherRequestItem] },
      },
    }),
    prisma.reliefRequest.deleteMany({
      where: { id: { in: [ids.request, ids.allocatedRequest, ids.otherRequest] } },
    }),
    prisma.warehouseStock.deleteMany({ where: { id: ids.stock } }),
    prisma.partnerOrganisation.deleteMany({
      where: { id: { in: [ids.partner, ids.inactivePartner, ids.otherPartner] } },
    }),
    prisma.rescueTeam.deleteMany({
      where: { id: { in: [ids.team, ids.enRouteTeam, ids.otherTeam] } },
    }),
    prisma.shelter.deleteMany({ where: { id: { in: [ids.shelter, ids.otherShelter] } } }),
    prisma.targetZone.deleteMany({ where: { id: { in: [ids.zone, ids.otherZone] } } }),
    prisma.location.deleteMany({
      where: { id: { in: [ids.shelterLocation, ids.teamLocation, ids.otherLocation] } },
    }),
    prisma.districtOfficer.deleteMany({ where: { userId: ids.officer } }),
    prisma.user.deleteMany({ where: { id: ids.officer } }),
  ]);
}

describeIntegration("Prisma relief read repository against isolated PostgreSQL", () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await cleanup();
    const createdAt = new Date("2026-09-25T10:00:00.000Z");
    await prisma.user.create({
      data: {
        id: ids.officer,
        name: "Integration District Officer",
        contactNo: "+94770000999",
        role: UserRole.DISTRICT_OFFICER,
        districtOfficer: { create: { districtId: ids.district } },
      },
    });
    await prisma.location.createMany({
      data: [
        {
          id: ids.shelterLocation,
          latitude: 6.9271,
          longitude: 79.8612,
          districtId: ids.district,
          address: "Integration shelter",
          source: "MANUAL",
        },
        {
          id: ids.teamLocation,
          latitude: 6.92,
          longitude: 79.87,
          districtId: ids.district,
          address: "Integration team base",
          source: "GPS",
        },
        {
          id: ids.otherLocation,
          latitude: 7,
          longitude: 80,
          districtId: ids.otherDistrict,
          address: "Other district",
          source: "MANUAL",
        },
      ],
    });
    await prisma.targetZone.createMany({
      data: [
        {
          id: ids.zone,
          name: "Integration Critical Zone",
          districtId: ids.district,
          severity: ZoneSeverity.CRITICAL,
          geometryRef: "integration:zone",
        },
        {
          id: ids.otherZone,
          name: "Other Zone",
          districtId: ids.otherDistrict,
          severity: ZoneSeverity.HIGH,
          geometryRef: "integration:other-zone",
        },
      ],
    });
    await prisma.shelter.createMany({
      data: [
        {
          id: ids.shelter,
          name: "Integration Shelter",
          districtId: ids.district,
          locationId: ids.shelterLocation,
          capacity: 200,
          currentOccupancy: 150,
        },
        {
          id: ids.otherShelter,
          name: "Other Shelter",
          districtId: ids.otherDistrict,
          locationId: ids.otherLocation,
          capacity: 100,
          currentOccupancy: 20,
        },
      ],
    });
    await prisma.reliefRequest.createMany({
      data: [
        {
          id: ids.request,
          shelterId: ids.shelter,
          targetZoneId: ids.zone,
          status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
          priorityNote: "Integration request",
          createdAt,
          version: 2,
        },
        {
          id: ids.allocatedRequest,
          shelterId: ids.shelter,
          targetZoneId: ids.zone,
          status: ReliefRequestStatus.ALLOCATED,
          priorityNote: null,
          createdAt,
          version: 3,
        },
        {
          id: ids.otherRequest,
          shelterId: ids.otherShelter,
          targetZoneId: ids.otherZone,
          status: ReliefRequestStatus.AWAITING_ALLOCATION,
          priorityNote: null,
          createdAt,
          version: 1,
        },
      ],
    });
    await prisma.reliefRequestItem.createMany({
      data: [
        {
          id: ids.requestItem,
          requestId: ids.request,
          supplyType: SupplyType.WATER,
          requestedQty: 100,
        },
        {
          id: ids.allocatedRequestItem,
          requestId: ids.allocatedRequest,
          supplyType: SupplyType.WATER,
          requestedQty: 10,
        },
        {
          id: ids.otherRequestItem,
          requestId: ids.otherRequest,
          supplyType: SupplyType.WATER,
          requestedQty: 50,
        },
      ],
    });
    await prisma.resourceAllocation.create({
      data: {
        id: ids.allocation,
        requestId: ids.request,
        officerId: ids.officer,
        idempotencyKey: "f7500000-0000-4000-8000-000000000001",
        notes: "Integration allocation",
        createdAt: new Date("2026-09-25T11:00:00.000Z"),
        items: {
          create: {
            id: ids.allocationItem,
            requestItemId: ids.requestItem,
            supplyType: SupplyType.WATER,
            allocatedQty: 40,
          },
        },
      },
    });
    await prisma.warehouseStock.create({
      data: {
        id: ids.stock,
        districtId: ids.district,
        supplyType: SupplyType.WATER,
        availableQty: 60,
        version: 2,
        syncedAt: createdAt,
      },
    });
    await prisma.partnerOrganisation.createMany({
      data: [
        {
          id: ids.partner,
          districtId: ids.district,
          name: "Integration NGO",
          type: PartnerOrganisationType.NGO,
          active: true,
        },
        {
          id: ids.inactivePartner,
          districtId: ids.district,
          name: "Inactive NGO",
          type: PartnerOrganisationType.NGO,
          active: false,
        },
        {
          id: ids.otherPartner,
          districtId: ids.otherDistrict,
          name: "Other NGO",
          type: PartnerOrganisationType.NGO,
          active: true,
        },
      ],
    });
    await prisma.rescueTeam.createMany({
      data: [
        {
          id: ids.team,
          districtId: ids.district,
          name: "Integration Team",
          status: RescueTeamStatus.AVAILABLE,
          locationId: ids.teamLocation,
          version: 1,
        },
        {
          id: ids.enRouteTeam,
          districtId: ids.district,
          name: "Busy Team",
          status: RescueTeamStatus.EN_ROUTE,
          locationId: ids.teamLocation,
          version: 2,
        },
        {
          id: ids.otherTeam,
          districtId: ids.otherDistrict,
          name: "Other Team",
          status: RescueTeamStatus.AVAILABLE,
          locationId: ids.otherLocation,
          version: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("verifies district filtering, cumulative history, stock, candidates, and read-only shelter fields", async () => {
    const repository = new PrismaReliefReadRepository(prisma);
    const shelterBefore = await prisma.shelter.findUniqueOrThrow({ where: { id: ids.shelter } });

    const queue = await repository.listActionableRequests({ districtId: ids.district });
    const requestDetails = await repository.findRequestById(ids.request);
    const stock = await repository.listWarehouseStock(ids.district, [SupplyType.WATER]);
    const partners = await repository.listActivePartners(ids.district);
    const teams = await repository.listAvailableRescueTeams(ids.district);

    expect(queue.map(({ id }) => id)).toEqual([ids.request]);
    expect(queue[0]?.items[0]?.allocationItems.map(({ allocatedQty }) => allocatedQty)).toEqual([
      40,
    ]);
    expect(requestDetails?.allocations).toEqual([
      expect.objectContaining({
        id: ids.allocation,
        items: [expect.objectContaining({ requestItemId: ids.requestItem, allocatedQty: 40 })],
      }),
    ]);
    expect(stock).toEqual([expect.objectContaining({ availableQty: 60, version: 2 })]);
    expect(partners.map(({ id }) => id)).toEqual([ids.partner]);
    expect(teams.map(({ id }) => id)).toEqual([ids.team]);

    const shelterAfter = await prisma.shelter.findUniqueOrThrow({ where: { id: ids.shelter } });
    expect(shelterAfter.currentOccupancy).toBe(shelterBefore.currentOccupancy);
    expect(shelterAfter.capacity).toBe(shelterBefore.capacity);
  });
});

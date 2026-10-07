import { ApiClientError } from "@disaster/api-client";
import {
  PartnerOrganisationType,
  PartnerResupplyStatus,
  ReliefRequestStatus,
  RescueTeamStatus,
  SupplyType,
  ZoneSeverity,
} from "@disaster/domain";
import type {
  ReliefAllocationReceipt,
  ReliefRequestDetails,
  ReliefRequestQueueResponse,
} from "@disaster/shared-types";
import { vi } from "vitest";

import type { ReliefAllocationApi } from "./relief-ui";

export const ids = {
  request: "70000000-0000-4000-8000-000000000001",
  requestTwo: "70000000-0000-4000-8000-000000000002",
  shelter: "60000000-0000-4000-8000-000000000001",
  water: "71000000-0000-4000-8000-000000000001",
  medical: "71000000-0000-4000-8000-000000000002",
  partner: "80000000-0000-4000-8000-000000000001",
  partnerTwo: "80000000-0000-4000-8000-000000000002",
  team: "90000000-0000-4000-8000-000000000001",
  key: "20000000-0000-4000-8000-000000000001",
} as const;

export const queue: ReliefRequestQueueResponse = [
  {
    requestId: ids.request,
    requestVersion: 4,
    status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
    createdAt: "2026-09-25T10:00:00.000Z",
    shelter: {
      id: ids.shelter,
      name: "Kelaniya Central Shelter",
      capacity: 200,
      currentOccupancy: 170,
      occupancyRate: 0.85,
    },
    targetZone: {
      id: "50000000-0000-4000-8000-000000000001",
      name: "Kelani River Bank",
      severity: ZoneSeverity.CRITICAL,
    },
    outstandingSupplies: [
      { supplyType: SupplyType.WATER, outstandingQty: 60 },
      { supplyType: SupplyType.MEDICAL_KIT, outstandingQty: 20 },
    ],
  },
  {
    requestId: ids.requestTwo,
    requestVersion: 1,
    status: ReliefRequestStatus.AWAITING_ALLOCATION,
    createdAt: "2026-09-25T09:00:00.000Z",
    shelter: {
      id: "60000000-0000-4000-8000-000000000002",
      name: "Biyagama Community Hall",
      capacity: 150,
      currentOccupancy: 90,
      occupancyRate: 0.6,
    },
    targetZone: {
      id: "50000000-0000-4000-8000-000000000002",
      name: "Biyagama North",
      severity: ZoneSeverity.HIGH,
    },
    outstandingSupplies: [{ supplyType: SupplyType.DRY_RATIONS, outstandingQty: 40 }],
  },
];

export const details: ReliefRequestDetails = {
  requestId: ids.request,
  requestVersion: 4,
  status: ReliefRequestStatus.PARTIALLY_ALLOCATED,
  priorityNote: "Medical supplies are urgently required.",
  createdAt: "2026-09-25T10:00:00.000Z",
  shelter: {
    id: ids.shelter,
    name: "Kelaniya Central Shelter",
    capacity: 200,
    currentOccupancy: 170,
    occupancyRate: 0.85,
    location: {
      latitude: 6.9553,
      longitude: 79.9217,
      address: "Kelaniya, Gampaha District",
    },
  },
  targetZone: {
    id: "50000000-0000-4000-8000-000000000001",
    name: "Kelani River Bank",
    severity: ZoneSeverity.CRITICAL,
  },
  items: [
    {
      requestItemId: ids.water,
      supplyType: SupplyType.WATER,
      requestedQty: 100,
      previouslyAllocatedQty: 40,
      outstandingQty: 60,
      warehouseStock: {
        availableQty: 60,
        version: 2,
        syncedAt: "2026-09-25T11:00:00.000Z",
      },
    },
    {
      requestItemId: ids.medical,
      supplyType: SupplyType.MEDICAL_KIT,
      requestedQty: 20,
      previouslyAllocatedQty: 0,
      outstandingQty: 20,
      warehouseStock: {
        availableQty: 8,
        version: 1,
        syncedAt: "2026-09-25T11:00:00.000Z",
      },
    },
  ],
  previousAllocations: [
    {
      allocationId: "30000000-0000-4000-8000-000000000001",
      createdAt: "2026-09-25T10:30:00.000Z",
      items: [
        {
          requestItemId: ids.water,
          supplyType: SupplyType.WATER,
          allocatedQty: 40,
        },
      ],
    },
  ],
  eligiblePartners: [
    {
      id: ids.partner,
      name: "Gampaha Relief Network",
      type: PartnerOrganisationType.NGO,
    },
    {
      id: ids.partnerTwo,
      name: "District Logistics Unit",
      type: PartnerOrganisationType.ARMED_FORCES,
    },
  ],
  availableRescueTeams: [
    { id: ids.team, name: "Kelani Rescue One", status: RescueTeamStatus.AVAILABLE },
  ],
};

export const receipt: ReliefAllocationReceipt = {
  allocationId: "30000000-0000-4000-8000-000000000099",
  requestId: ids.request,
  requestStatus: ReliefRequestStatus.PARTIALLY_ALLOCATED,
  items: [
    { supplyType: SupplyType.WATER, allocatedQty: 60 },
    { supplyType: SupplyType.MEDICAL_KIT, allocatedQty: 8 },
  ],
  resupplyRequests: [
    {
      id: "32000000-0000-4000-8000-000000000001",
      supplyType: SupplyType.MEDICAL_KIT,
      requestedQty: 12,
      status: PartnerResupplyStatus.REQUESTED,
    },
  ],
  dispatch: {
    id: "33000000-0000-4000-8000-000000000001",
    teamId: ids.team,
    status: RescueTeamStatus.EN_ROUTE,
  },
  createdAt: "2026-09-25T12:00:00.000Z",
};

export function createMockApi(overrides: Partial<ReliefAllocationApi> = {}): ReliefAllocationApi {
  return {
    listReliefRequests: vi.fn(async () => queue),
    getReliefRequest: vi.fn(async () => details),
    createReliefAllocation: vi.fn(async () => receipt),
    getReliefAllocationByIdempotencyKey: vi.fn(async () => receipt),
    ...overrides,
  };
}

export function apiError(code: string, status = 409): ApiClientError {
  return new ApiClientError(status, {
    error: {
      code,
      message: `Safe ${code} message.`,
      fieldErrors: {},
      details: {},
    },
  });
}

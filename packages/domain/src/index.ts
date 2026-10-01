function enumValues<const T extends Record<string, string>>(value: T) {
  return Object.freeze(Object.values(value)) as unknown as readonly [T[keyof T], ...T[keyof T][]];
}

export const UserRole = {
  CITIZEN: "CITIZEN",
  VOLUNTEER: "VOLUNTEER",
  DMC_DUTY_OFFICER: "DMC_DUTY_OFFICER",
  DISTRICT_OFFICER: "DISTRICT_OFFICER",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLES = enumValues(UserRole);

export const HazardType = {
  FLOOD: "FLOOD",
  LANDSLIDE: "LANDSLIDE",
  CYCLONE: "CYCLONE",
  DROUGHT: "DROUGHT",
} as const;
export type HazardType = (typeof HazardType)[keyof typeof HazardType];
export const HAZARD_TYPES = enumValues(HazardType);

export const LocationSource = { GPS: "GPS", MANUAL: "MANUAL" } as const;
export type LocationSource = (typeof LocationSource)[keyof typeof LocationSource];
export const LOCATION_SOURCES = enumValues(LocationSource);

export const ReportStatus = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];
export const REPORT_STATUSES = enumValues(ReportStatus);

export const VerificationResult = { VERIFIED: "VERIFIED", REJECTED: "REJECTED" } as const;
export type VerificationResult = (typeof VerificationResult)[keyof typeof VerificationResult];
export const VERIFICATION_RESULTS = enumValues(VerificationResult);

export const AlertStatus = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
  CANCELLED: "CANCELLED",
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];
export const ALERT_STATUSES = enumValues(AlertStatus);

export const AlertSeverity = {
  ADVISORY: "ADVISORY",
  WARNING: "WARNING",
  EVACUATION: "EVACUATION",
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];
export const ALERT_SEVERITIES = enumValues(AlertSeverity);

export const DeliveryStatus = {
  PENDING: "PENDING",
  PUSH_SENT: "PUSH_SENT",
  PUSH_FAILED: "PUSH_FAILED",
  SMS_FALLBACK_QUEUED: "SMS_FALLBACK_QUEUED",
  SMS_SENT: "SMS_SENT",
  FAILED_FINAL: "FAILED_FINAL",
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];
export const DELIVERY_STATUSES = enumValues(DeliveryStatus);

export const ReliefRequestStatus = {
  AWAITING_ALLOCATION: "AWAITING_ALLOCATION",
  PARTIALLY_ALLOCATED: "PARTIALLY_ALLOCATED",
  AWAITING_RESUPPLY: "AWAITING_RESUPPLY",
  ALLOCATED: "ALLOCATED",
} as const;
export type ReliefRequestStatus = (typeof ReliefRequestStatus)[keyof typeof ReliefRequestStatus];
export const RELIEF_REQUEST_STATUSES = enumValues(ReliefRequestStatus);

export const ZoneSeverity = {
  LOW: "LOW",
  MODERATE: "MODERATE",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type ZoneSeverity = (typeof ZoneSeverity)[keyof typeof ZoneSeverity];
export const ZONE_SEVERITIES = enumValues(ZoneSeverity);

export const SupplyType = {
  DRY_RATIONS: "DRY_RATIONS",
  WATER: "WATER",
  TENT: "TENT",
  MEDICAL_KIT: "MEDICAL_KIT",
} as const;
export type SupplyType = (typeof SupplyType)[keyof typeof SupplyType];
export const SUPPLY_TYPES = enumValues(SupplyType);

export const RescueTeamStatus = {
  AVAILABLE: "AVAILABLE",
  EN_ROUTE: "EN_ROUTE",
  UNAVAILABLE: "UNAVAILABLE",
} as const;
export type RescueTeamStatus = (typeof RescueTeamStatus)[keyof typeof RescueTeamStatus];
export const RESCUE_TEAM_STATUSES = enumValues(RescueTeamStatus);

export const PartnerOrganisationType = {
  NGO: "NGO",
  ARMED_FORCES: "ARMED_FORCES",
  PRIVATE_DONOR: "PRIVATE_DONOR",
} as const;
export type PartnerOrganisationType =
  (typeof PartnerOrganisationType)[keyof typeof PartnerOrganisationType];
export const PARTNER_ORGANISATION_TYPES = enumValues(PartnerOrganisationType);

export const PartnerResupplyStatus = {
  REQUESTED: "REQUESTED",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  FULFILLED: "FULFILLED",
  CANCELLED: "CANCELLED",
} as const;
export type PartnerResupplyStatus =
  (typeof PartnerResupplyStatus)[keyof typeof PartnerResupplyStatus];
export const PARTNER_RESUPPLY_STATUSES = enumValues(PartnerResupplyStatus);

export function canTransitionReport(current: ReportStatus, result: VerificationResult): boolean {
  return current === ReportStatus.PENDING && result in VerificationResult;
}

export function isPublicAlert(status: AlertStatus): boolean {
  return status === AlertStatus.ACTIVE;
}

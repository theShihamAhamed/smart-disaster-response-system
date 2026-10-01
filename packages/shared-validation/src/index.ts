import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  DELIVERY_STATUSES,
  HAZARD_TYPES,
  LOCATION_SOURCES,
  PARTNER_ORGANISATION_TYPES,
  PARTNER_RESUPPLY_STATUSES,
  RELIEF_REQUEST_STATUSES,
  REPORT_STATUSES,
  RESCUE_TEAM_STATUSES,
  SUPPLY_TYPES,
  USER_ROLES,
  VERIFICATION_RESULTS,
  ZONE_SEVERITIES,
} from "@disaster/domain";
import { z } from "zod";

const zodEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const latitudeSchema = z.number().finite().min(-90).max(90);
export const longitudeSchema = z.number().finite().min(-180).max(180);

export const userRoleSchema = zodEnum(USER_ROLES);
export const hazardTypeSchema = zodEnum(HAZARD_TYPES);
export const locationSourceSchema = zodEnum(LOCATION_SOURCES);
export const reportStatusSchema = zodEnum(REPORT_STATUSES);
export const verificationResultSchema = zodEnum(VERIFICATION_RESULTS);
export const alertStatusSchema = zodEnum(ALERT_STATUSES);
export const alertSeveritySchema = zodEnum(ALERT_SEVERITIES);
export const deliveryStatusSchema = zodEnum(DELIVERY_STATUSES);
export const reliefRequestStatusSchema = zodEnum(RELIEF_REQUEST_STATUSES);
export const zoneSeveritySchema = zodEnum(ZONE_SEVERITIES);
export const supplyTypeSchema = zodEnum(SUPPLY_TYPES);
export const rescueTeamStatusSchema = zodEnum(RESCUE_TEAM_STATUSES);
export const partnerOrganisationTypeSchema = zodEnum(PARTNER_ORGANISATION_TYPES);
export const partnerResupplyStatusSchema = zodEnum(PARTNER_RESUPPLY_STATUSES);

export const locationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  source: locationSourceSchema,
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    fieldErrors: z.record(z.array(z.string())),
    details: z.record(z.unknown()),
  }),
});

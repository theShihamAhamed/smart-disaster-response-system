import { RELIEF_REQUEST_STATUSES, ZONE_SEVERITIES } from "@disaster/domain";
import { z } from "zod";

const reliefUuidSchema = z.string().uuid();

export const reliefRequestIdSchema = reliefUuidSchema;
export const reliefRequestItemIdSchema = reliefUuidSchema;
export const partnerOrganisationIdSchema = reliefUuidSchema;
export const rescueTeamIdSchema = reliefUuidSchema;
export const reliefAllocationIdempotencyKeySchema = reliefUuidSchema;

export const reliefQuantitySchema = z.number().int().safe().nonnegative();
export const reliefRequestVersionSchema = z.number().int().safe().positive();

export const reliefRequestQueueQuerySchema = z
  .object({
    status: z.enum(RELIEF_REQUEST_STATUSES).optional(),
    zoneSeverity: z.enum(ZONE_SEVERITIES).optional(),
  })
  .strict();

export const reliefRequestPathParamsSchema = z
  .object({ requestId: reliefRequestIdSchema })
  .strict();

export const reliefAllocationLookupPathParamsSchema = z
  .object({ key: reliefAllocationIdempotencyKeySchema })
  .strict();

export const reliefAllocationHeadersSchema = z
  .object({ "idempotency-key": reliefAllocationIdempotencyKeySchema })
  .strict();

export const reliefAllocationItemCommandSchema = z
  .object({
    requestItemId: reliefRequestItemIdSchema,
    allocateQty: reliefQuantitySchema,
  })
  .strict();

export const reliefShortagePartnerSelectionSchema = z
  .object({
    requestItemId: reliefRequestItemIdSchema,
    partnerOrganisationId: partnerOrganisationIdSchema,
  })
  .strict();

function rejectDuplicateRequestItemIds(
  values: readonly { readonly requestItemId: string }[],
  context: z.RefinementCtx,
  message: string,
) {
  const seen = new Set<string>();

  values.forEach((value, index) => {
    if (seen.has(value.requestItemId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path: [index, "requestItemId"],
      });
    }
    seen.add(value.requestItemId);
  });
}

const allocationItemsSchema = z
  .array(reliefAllocationItemCommandSchema)
  .min(1)
  .superRefine((values, context) => {
    rejectDuplicateRequestItemIds(values, context, "Duplicate allocation request item.");
  });

const shortageSelectionsSchema = z
  .array(reliefShortagePartnerSelectionSchema)
  .superRefine((values, context) => {
    rejectDuplicateRequestItemIds(values, context, "Duplicate shortage partner selection.");
  });

export const reliefAllocationCommandSchema = z
  .object({
    requestVersion: reliefRequestVersionSchema,
    items: allocationItemsSchema,
    shortages: shortageSelectionsSchema,
    rescueTeamId: rescueTeamIdSchema.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

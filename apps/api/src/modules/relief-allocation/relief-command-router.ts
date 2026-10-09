import { UserRole } from "@disaster/domain";
import { Router } from "express";

import { requireRoles } from "../../authorization.js";
import { createReliefCommandController } from "./relief-command-controller.js";
import type { ReliefCommandOperations } from "./relief-command-service.js";

export function createReliefCommandRouter(service: ReliefCommandOperations): Router {
  const router = Router();
  const controller = createReliefCommandController(service);

  router.post(
    "/relief-requests/:requestId/allocations",
    requireRoles(UserRole.DISTRICT_OFFICER),
    controller.allocateReliefResources,
  );

  router.get(
    "/allocations/by-idempotency-key/:key",
    requireRoles(UserRole.DISTRICT_OFFICER),
    controller.getReceiptByIdempotencyKey,
  );

  return router;
}

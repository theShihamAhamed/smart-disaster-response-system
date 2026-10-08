import { UserRole } from "@disaster/domain";
import { Router } from "express";

import { requireRoles } from "../../authorization.js";
import { createReliefReadController } from "./relief-read-controller.js";
import type { ReliefReadOperations } from "./relief-read-service.js";

export function createReliefReadRouter(service: ReliefReadOperations): Router {
  const router = Router();
  const controller = createReliefReadController(service);

  router.get(
    "/relief-requests",
    requireRoles(UserRole.DISTRICT_OFFICER),
    controller.listRankedRequests,
  );
  router.get(
    "/relief-requests/:requestId",
    requireRoles(UserRole.DISTRICT_OFFICER),
    controller.getRequestDetails,
  );

  return router;
}

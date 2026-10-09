import { UserRole } from "@disaster/domain";
import { Router } from "express";
import { requireRoles } from "../../authorization.js";
import type { HazardBroadcastService } from "../hazard-broadcast/alert.service.js";
import { VerificationController } from "./verification.controller.js";
import type { HazardVerificationService } from "./hazard-verification.service.js";

export function createVerificationRouter(
  service: HazardVerificationService,
  broadcastService: Pick<HazardBroadcastService, "createAlertFromVerifiedReport">,
): Router {
  const router = Router();
  const controller = new VerificationController(service, broadcastService);
  router.use(requireRoles(UserRole.DMC_DUTY_OFFICER));
  router.get("/reports", controller.listPendingReports);
  router.get("/reports/:reportId", controller.getReportForReview);
  router.post("/reports/:reportId/decision", controller.decideReport);
  router.post("/reports/:reportId/escalations", controller.escalateReport);
  return router;
}

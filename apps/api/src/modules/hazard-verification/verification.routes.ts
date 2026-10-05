import { UserRole } from "@disaster/domain";
import { Router } from "express";
import { requireRoles } from "../../authorization.js";
import { VerificationController } from "./verification.controller.js";
import type { HazardVerificationService } from "./hazard-verification.service.js";

export function createVerificationRouter(service: HazardVerificationService): Router {
  const router = Router();
  const controller = new VerificationController(service);
  router.use(requireRoles(UserRole.DMC_DUTY_OFFICER));
  router.get("/reports", controller.listPendingReports);
  router.get("/reports/:reportId", controller.getReportForReview);
  router.post("/reports/:reportId/decision", controller.decideReport);
  return router;
}

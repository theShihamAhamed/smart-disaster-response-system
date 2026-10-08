import { UserRole } from "@disaster/domain";
import { Router } from "express";
import { requireRoles } from "../../authorization.js";
import type { HazardSubmissionService } from "./hazard-submission.service.js";
import { SubmissionController } from "./submission.controller.js";

export function createHazardSubmissionRouter(service: HazardSubmissionService): Router {
  const router = Router();
  const controller = new SubmissionController(service);
  // Only citizens and volunteers may report; officers are rejected with 403.
  router.use(requireRoles(UserRole.CITIZEN, UserRole.VOLUNTEER));
  router.post("/", controller.submit);
  router.get("/:reportId/status", controller.getStatus);
  return router;
}

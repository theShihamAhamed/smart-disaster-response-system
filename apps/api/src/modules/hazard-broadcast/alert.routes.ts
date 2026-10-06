import { UserRole } from "@disaster/domain";
import { Router } from "express";
import { requireRoles } from "../../authorization.js";
import { AlertController } from "./alert.controller.js";
import type { HazardBroadcastService } from "./alert.service.js";

export function createAlertRouter(service: HazardBroadcastService): Router {
  const router = Router();
  const controller = new AlertController(service);
  router.use(requireRoles(UserRole.DMC_DUTY_OFFICER));
  router.post("/from-report/:reportId", controller.createFromReport);
  return router;
}

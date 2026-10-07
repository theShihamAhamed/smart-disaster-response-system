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
  router.patch("/:alertId", controller.updateDraft);
  router.get("/:alertId/preview", controller.getPreview);
  router.get("/:alertId/similar-active", controller.getSimilarActive);
  router.post("/:alertId/broadcast", controller.broadcastAlert);
  router.get("/:alertId/deliveries", controller.getDeliveries);
  router.post("/:alertId/deliveries/retry", controller.retryDeliveries);
  router.post("/:alertId/replacement-drafts", controller.createReplacementDraft);
  router.post("/:alertId/cancel", controller.cancelAlert);
  return router;
}

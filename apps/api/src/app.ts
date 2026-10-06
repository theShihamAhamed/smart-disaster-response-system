import { API_BASE_PATH } from "@disaster/config";
import express from "express";
import {
  createDevelopmentAuthContext,
  createPrismaDevelopmentAuthResolver,
  type ResolveDevelopmentAuthUser,
} from "./development-auth.js";
import { createWebCors } from "./cors.js";
import { errorEnvelope, errorHandler } from "./errors.js";
import { createSeedGeoAdapter } from "./modules/hazard-submission/mock-geo-adapter.js";
import { PrismaHazardSubmissionRepository } from "./modules/hazard-submission/hazard-submission.repository.js";
import { HazardSubmissionService } from "./modules/hazard-submission/hazard-submission.service.js";
import { createHazardSubmissionRouter } from "./modules/hazard-submission/submission.routes.js";
import { PrismaHazardVerificationRepository } from "./modules/hazard-verification/hazard-verification.repository.js";
import { HazardVerificationService } from "./modules/hazard-verification/hazard-verification.service.js";
import { createVerificationRouter } from "./modules/hazard-verification/verification.routes.js";
import { PrismaHazardBroadcastRepository } from "./modules/hazard-broadcast/alert.repository.js";
import { HazardBroadcastService } from "./modules/hazard-broadcast/alert.service.js";
import { createAlertRouter } from "./modules/hazard-broadcast/alert.routes.js";
import { prisma } from "./prisma.js";
import { requestId } from "./request-id.js";

export interface AppDependencies {
  readonly resolveDevelopmentAuthUser?: ResolveDevelopmentAuthUser;
  readonly submissionService?: HazardSubmissionService;
  readonly verificationService?: HazardVerificationService;
  readonly broadcastService?: HazardBroadcastService;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(createWebCors());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);

  const health = (_request: express.Request, response: express.Response) => {
    response.status(200).json({ status: "ok" });
  };
  app.get("/health", health);
  app.get(`${API_BASE_PATH}/health`, health);

  const resolveDevelopmentAuthUser =
    dependencies.resolveDevelopmentAuthUser ?? createPrismaDevelopmentAuthResolver(prisma);
  app.use(createDevelopmentAuthContext(resolveDevelopmentAuthUser));
  const submissionService =
    dependencies.submissionService ??
    new HazardSubmissionService(
      new PrismaHazardSubmissionRepository(prisma),
      createSeedGeoAdapter(),
    );
  app.use(`${API_BASE_PATH}/hazard-reports`, createHazardSubmissionRouter(submissionService));
  const verificationService =
    dependencies.verificationService ??
    new HazardVerificationService(new PrismaHazardVerificationRepository(prisma));
  app.use(`${API_BASE_PATH}/verification`, createVerificationRouter(verificationService));
  const broadcastService =
    dependencies.broadcastService ??
    new HazardBroadcastService(new PrismaHazardBroadcastRepository(prisma));
  app.use(`${API_BASE_PATH}/alerts`, createAlertRouter(broadcastService));

  app.use((_request, response) => {
    response.status(404).json(errorEnvelope("NOT_FOUND", "The requested resource was not found."));
  });
  app.use(errorHandler);
  return app;
}

import { API_BASE_PATH } from "@disaster/config";
import express from "express";
import {
  createDevelopmentAuthContext,
  createPrismaDevelopmentAuthResolver,
  type ResolveDevelopmentAuthUser,
} from "./development-auth.js";
import { createWebCors } from "./cors.js";
import { errorEnvelope, errorHandler } from "./errors.js";
import { PrismaHazardBroadcastRepository } from "./modules/hazard-broadcast/alert.repository.js";
import { createAlertRouter } from "./modules/hazard-broadcast/alert.routes.js";
import { HazardBroadcastService } from "./modules/hazard-broadcast/alert.service.js";
import { PrismaHazardSubmissionRepository } from "./modules/hazard-submission/hazard-submission.repository.js";
import { HazardSubmissionService } from "./modules/hazard-submission/hazard-submission.service.js";
import { createSeedGeoAdapter } from "./modules/hazard-submission/mock-geo-adapter.js";
import { createHazardSubmissionRouter } from "./modules/hazard-submission/submission.routes.js";
import { PrismaHazardVerificationRepository } from "./modules/hazard-verification/hazard-verification.repository.js";
import { HazardVerificationService } from "./modules/hazard-verification/hazard-verification.service.js";
import { createVerificationRouter } from "./modules/hazard-verification/verification.routes.js";
import { PrismaReliefAllocationCommandRepository } from "./modules/relief-allocation/prisma-relief-command-repository.js";
import { PrismaReliefAllocationTransaction } from "./modules/relief-allocation/prisma-relief-allocation-transaction.js";
import { createReliefCommandRouter } from "./modules/relief-allocation/relief-command-router.js";
import {
  ReliefAllocationCommandService,
  type ReliefCommandOperations,
} from "./modules/relief-allocation/relief-command-service.js";
import { PrismaReliefReadRepository } from "./modules/relief-allocation/prisma-relief-read-repository.js";
import { createReliefReadRouter } from "./modules/relief-allocation/relief-read-router.js";
import {
  ReliefReadService,
  type ReliefReadOperations,
} from "./modules/relief-allocation/relief-read-service.js";
import { prisma } from "./prisma.js";
import { requestId } from "./request-id.js";

export interface AppDependencies {
  readonly resolveDevelopmentAuthUser?: ResolveDevelopmentAuthUser;
  readonly broadcastService?: HazardBroadcastService;
  readonly submissionService?: HazardSubmissionService;
  readonly verificationService?: HazardVerificationService;
  readonly reliefCommandService?: ReliefCommandOperations;
  readonly reliefReadService?: ReliefReadOperations;
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
  const broadcastService =
    dependencies.broadcastService ??
    new HazardBroadcastService(new PrismaHazardBroadcastRepository(prisma));
  app.use(
    `${API_BASE_PATH}/verification`,
    createVerificationRouter(verificationService, broadcastService),
  );
  app.use(`${API_BASE_PATH}/alerts`, createAlertRouter(broadcastService));

  const reliefReadService =
    dependencies.reliefReadService ?? new ReliefReadService(new PrismaReliefReadRepository(prisma));
  app.use(API_BASE_PATH, createReliefReadRouter(reliefReadService));

  const reliefCommandRepository = new PrismaReliefAllocationCommandRepository(prisma);
  const reliefCommandService =
    dependencies.reliefCommandService ??
    new ReliefAllocationCommandService(
      reliefCommandRepository,
      new PrismaReliefAllocationTransaction(prisma),
    );
  app.use(API_BASE_PATH, createReliefCommandRouter(reliefCommandService));

  app.use((_request, response) => {
    response.status(404).json(errorEnvelope("NOT_FOUND", "The requested resource was not found."));
  });
  app.use(errorHandler);
  return app;
}

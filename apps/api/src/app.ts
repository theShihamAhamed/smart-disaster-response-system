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
import { prisma } from "./prisma.js";
import { requestId } from "./request-id.js";

export interface AppDependencies {
  readonly resolveDevelopmentAuthUser?: ResolveDevelopmentAuthUser;
  readonly submissionService?: HazardSubmissionService;
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

  app.use((_request, response) => {
    response.status(404).json(errorEnvelope("NOT_FOUND", "The requested resource was not found."));
  });
  app.use(errorHandler);
  return app;
}

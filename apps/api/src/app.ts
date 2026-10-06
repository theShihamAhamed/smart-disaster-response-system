import { API_BASE_PATH } from "@disaster/config";
import express from "express";
import {
  createDevelopmentAuthContext,
  createPrismaDevelopmentAuthResolver,
  type ResolveDevelopmentAuthUser,
} from "./development-auth.js";
import { createWebCors } from "./cors.js";
import { errorEnvelope, errorHandler } from "./errors.js";
import { PrismaReliefAllocationCommandRepository } from "./modules/relief-allocation/prisma-relief-command-repository.js";
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

  const reliefReadService =
    dependencies.reliefReadService ?? new ReliefReadService(new PrismaReliefReadRepository(prisma));
  app.use(API_BASE_PATH, createReliefReadRouter(reliefReadService));

  const reliefCommandService =
    dependencies.reliefCommandService ??
    new ReliefAllocationCommandService(new PrismaReliefAllocationCommandRepository(prisma));
  app.use(API_BASE_PATH, createReliefCommandRouter(reliefCommandService));

  app.use((_request, response) => {
    response.status(404).json(errorEnvelope("NOT_FOUND", "The requested resource was not found."));
  });
  app.use(errorHandler);
  return app;
}

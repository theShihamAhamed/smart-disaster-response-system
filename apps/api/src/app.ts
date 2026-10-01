import { API_BASE_PATH } from "@disaster/config";
import express from "express";
import { errorEnvelope, errorHandler } from "./errors.js";
import { requestId } from "./request-id.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);

  const health = (_request: express.Request, response: express.Response) => {
    response.status(200).json({ status: "ok" });
  };
  app.get("/health", health);
  app.get(`${API_BASE_PATH}/health`, health);

  app.use((_request, response) => {
    response.status(404).json(errorEnvelope("NOT_FOUND", "The requested resource was not found."));
  });
  app.use(errorHandler);
  return app;
}

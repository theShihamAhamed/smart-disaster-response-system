import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestId: RequestHandler = (request, response, next) => {
  const incoming = request.header("x-request-id")?.trim();
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  response.locals.requestId = id;
  response.setHeader("x-request-id", id);
  next();
};

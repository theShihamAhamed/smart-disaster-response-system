import cors from "cors";

export const WEB_CORS_METHODS = ["GET", "POST", "PATCH", "OPTIONS"] as const;
export const WEB_CORS_HEADERS = [
  "Accept",
  "Content-Type",
  "Idempotency-Key",
  "X-Dev-User-Id",
] as const;

export interface CorsEnvironment {
  readonly WEB_ORIGIN?: string;
}

export function readWebOrigin(environment: CorsEnvironment = process.env): string | undefined {
  const candidate = environment.WEB_ORIGIN?.trim();

  if (!candidate) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("WEB_ORIGIN must be a valid absolute HTTP(S) origin.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("WEB_ORIGIN must use the http: or https: protocol.");
  }

  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("WEB_ORIGIN must contain only an origin without a path or credentials.");
  }

  return url.origin;
}

export function createWebCors(environment: CorsEnvironment = process.env) {
  const allowedOrigin = readWebOrigin(environment);

  return cors({
    origin(requestOrigin, callback) {
      callback(null, Boolean(allowedOrigin && requestOrigin === allowedOrigin));
    },
    methods: [...WEB_CORS_METHODS],
    allowedHeaders: [...WEB_CORS_HEADERS],
    credentials: false,
    optionsSuccessStatus: 204,
  });
}

import { createHttpClient } from "@disaster/api-client";

import type { WebConfig } from "./web-config";

const DEV_USER_HEADER = "X-Dev-User-Id";

export function createWebApiClient(config: WebConfig, fetchImpl: typeof fetch = fetch) {
  const defaultHeaders = config.devUserId ? { [DEV_USER_HEADER]: config.devUserId } : undefined;

  return createHttpClient({
    baseUrl: config.apiBaseUrl,
    fetchImpl,
    ...(defaultHeaders ? { defaultHeaders } : {}),
  });
}

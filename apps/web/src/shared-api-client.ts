import { createWebApiClient } from "./web-api-client";
import { readWebConfig } from "./web-config";

export const sharedApiClient = createWebApiClient(readWebConfig());

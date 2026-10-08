import { API_BASE_PATH, DEFAULT_API_PORT } from "@disaster/config";
import { uuidSchema } from "@disaster/shared-validation";

export interface MobileConfig {
  readonly apiBaseUrl: string;
  /** Development login: sent as the X-Dev-User-Id header. Not a secret. */
  readonly devUserId: string | null;
  readonly requestTimeoutMs: number;
}

export interface MobileEnvironment {
  readonly EXPO_PUBLIC_API_BASE_URL?: string | undefined;
  readonly EXPO_PUBLIC_DEV_USER_ID?: string | undefined;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Reads the app settings. A wrong setting stops the app early with a clear message. */
export function readMobileConfig(environment: MobileEnvironment): MobileConfig {
  const rawUrl =
    environment.EXPO_PUBLIC_API_BASE_URL?.trim() ||
    `http://localhost:${DEFAULT_API_PORT}${API_BASE_PATH}`;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      "EXPO_PUBLIC_API_BASE_URL must be a full web address, like http://192.168.1.5:4000/api/v1",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("EXPO_PUBLIC_API_BASE_URL must start with http:// or https://");
  }

  const rawUser = environment.EXPO_PUBLIC_DEV_USER_ID?.trim();
  if (rawUser && !uuidSchema.safeParse(rawUser).success) {
    throw new Error(
      "EXPO_PUBLIC_DEV_USER_ID must be a user id like 10000000-0000-4000-8000-000000000001",
    );
  }

  return {
    apiBaseUrl: rawUrl.replace(/\/+$/, ""),
    devUserId: rawUser || null,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

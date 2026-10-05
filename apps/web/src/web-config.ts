export interface WebEnvironment {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_USER_ID?: string;
}

export interface WebConfig {
  readonly apiBaseUrl: string;
  readonly devUserId?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim();

  if (!candidate) {
    throw new Error("VITE_API_BASE_URL is required for the officer web application.");
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("VITE_API_BASE_URL must be a valid absolute HTTP(S) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_API_BASE_URL must use the http: or https: protocol.");
  }

  if (url.search || url.hash) {
    throw new Error("VITE_API_BASE_URL must not contain a query string or fragment.");
  }

  return url.toString().replace(/\/+$/, "");
}

function readDevUserId(value: string | undefined): string | undefined {
  const candidate = value?.trim();

  if (!candidate) {
    return undefined;
  }

  if (!UUID_PATTERN.test(candidate)) {
    throw new Error("VITE_DEV_USER_ID must be a valid UUID when provided.");
  }

  return candidate;
}

export function readWebConfig(environment: WebEnvironment = import.meta.env): WebConfig {
  const apiBaseUrl = readApiBaseUrl(environment.VITE_API_BASE_URL);
  const devUserId = readDevUserId(environment.VITE_DEV_USER_ID);

  return devUserId ? { apiBaseUrl, devUserId } : { apiBaseUrl };
}

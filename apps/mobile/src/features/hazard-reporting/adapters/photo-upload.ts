import { File } from "expo-file-system";
import type { PhotoStorage, PersistedPhoto } from "../ports/photo-storage";
import { expoPhotoStorage } from "./expo-photo-storage";

export interface PhotoUploadOptions {
  readonly baseUrl: string;
  readonly devUserId: string | null;
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

interface PhotoUploadResponse {
  readonly photoRef: string;
}

function isRetryableUploadStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export function createPhotoUploadStorage(options: PhotoUploadOptions): PhotoStorage {
  return {
    async persist(sourceUri, clientReportId): Promise<PersistedPhoto> {
      const local = await expoPhotoStorage.persist(sourceUri, clientReportId);
      try {
        return {
          localUri: local.localUri,
          photoRef: await uploadPhoto(local.localUri, clientReportId),
        };
      } catch (error) {
        if (isRetryableUploadError(error)) {
          // Keep the durable copy. ReportSyncService retries the upload before sending the report.
          return { localUri: local.localUri, photoRef: local.localUri };
        }
        await expoPhotoStorage.remove(local.localUri);
        throw error;
      }
    },

    async upload(localUri, clientReportId): Promise<string> {
      return uploadPhoto(localUri, clientReportId);
    },

    remove(localUri) {
      return expoPhotoStorage.remove(localUri);
    },
  };

  async function uploadPhoto(localUri: string, clientReportId: string): Promise<string> {
    const form = new FormData();
    form.append("clientReportId", clientReportId);
    form.append("photo", new File(localUri));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(
        `${options.baseUrl.replace(/\/+$/, "")}/hazard-reports/photos`,
        {
          method: "POST",
          ...(options.devUserId ? { headers: { "X-Dev-User-Id": options.devUserId } } : {}),
          body: form,
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new PhotoUploadError(
        `Photo upload failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    const body = (await response.json()) as PhotoUploadResponse;
    if (!body.photoRef) {
      throw new Error("Photo upload returned no photo reference.");
    }
    return body.photoRef;
  }
}

class PhotoUploadError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

function isRetryableUploadError(error: unknown): boolean {
  return error instanceof PhotoUploadError
    ? isRetryableUploadStatus(error.status)
    : error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

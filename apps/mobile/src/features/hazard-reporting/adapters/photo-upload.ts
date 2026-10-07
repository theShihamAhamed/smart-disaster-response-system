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

export function createPhotoUploadStorage(options: PhotoUploadOptions): PhotoStorage {
  return {
    async persist(sourceUri, clientReportId): Promise<PersistedPhoto> {
      const local = await expoPhotoStorage.persist(sourceUri, clientReportId);
      try {
        const form = new FormData();
        form.append("clientReportId", clientReportId);
        form.append("photo", new File(local.localUri));

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
          throw new Error(`Photo upload failed with HTTP ${response.status}.`);
        }

        const body = (await response.json()) as PhotoUploadResponse;
        if (!body.photoRef) {
          throw new Error("Photo upload returned no photo reference.");
        }
        return { localUri: local.localUri, photoRef: body.photoRef };
      } catch (error) {
        await expoPhotoStorage.remove(local.localUri);
        throw error;
      }
    },

    remove(localUri) {
      return expoPhotoStorage.remove(localUri);
    },
  };
}

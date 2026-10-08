import { expoGpsProvider } from "./adapters/expo-gps-provider";
import { expoOfflineStore } from "./adapters/expo-offline-store";
import { expoConnectivityProvider } from "./adapters/expo-connectivity-provider";
import { createPhotoUploadStorage } from "./adapters/photo-upload";
import { readMobileConfig } from "./config";

// ⚠️ CHECK ME: open each of these files and match the constructor arguments.
import { ReportSubmissionService } from "./services/report-submission-service";
import { ReportSyncService } from "./services/report-sync-service";
import { ReportStatusService } from "./services/report-status-service";
import { createHttpHazardReportApi } from "./adapters/http-hazard-report-api";
import { OfflineReportRepository } from "./repositories/offline-report-repository";
import { PhotoRepository } from "./repositories/photo-repository";

const config = readMobileConfig({
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_DEV_USER_ID: process.env.EXPO_PUBLIC_DEV_USER_ID,
});

const api = createHttpHazardReportApi({
  baseUrl: config.apiBaseUrl,
  devUserId: config.devUserId,
  timeoutMs: config.requestTimeoutMs,
});

export const gpsProvider = expoGpsProvider;
export const connectivity = expoConnectivityProvider;

const repository = new OfflineReportRepository(expoOfflineStore);
const photos = new PhotoRepository(
  createPhotoUploadStorage({
    baseUrl: config.apiBaseUrl,
    devUserId: config.devUserId,
    timeoutMs: config.requestTimeoutMs,
  }),
);

export const syncService = new ReportSyncService({
  api,
  repository,
  photos,
  connectivity,
});

export const submissionService = new ReportSubmissionService({
  repository,
  photos,
  sync: syncService,
  connectivity,
});

export const statusService = new ReportStatusService(api, repository);

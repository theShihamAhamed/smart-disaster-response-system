import type { StoredReport } from "../types";

/** Port: durable storage for the whole offline queue (AsyncStorage on a real phone). */
export interface OfflineReportStore {
  read(): Promise<readonly StoredReport[]>;
  write(reports: readonly StoredReport[]): Promise<void>;
}

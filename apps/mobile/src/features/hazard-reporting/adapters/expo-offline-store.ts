import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OfflineReportStore } from "../ports/offline-report-store";
import type { StoredReport } from "../types";

const KEY = "hazard-reporting:offline-queue:v1";

async function readAll(): Promise<StoredReport[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as StoredReport[]) : [];
}

async function writeAll(records: readonly StoredReport[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(records));
}

export const expoOfflineStore: OfflineReportStore = {
  async read() {
    return readAll();
  },

  async write(records) {
    await writeAll(records);
  },
};

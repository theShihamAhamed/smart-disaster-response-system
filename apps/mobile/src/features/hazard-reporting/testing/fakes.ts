import type { SubmitHazardReportInput } from "@disaster/shared-validation";
import type {
  HazardReportStatusResponse,
  SubmitHazardReportResponse,
} from "@disaster/shared-types";
import type { ConnectivityProvider } from "../ports/connectivity-provider";
import type { GpsProvider, GpsReading } from "../ports/gps-provider";
import {
  HazardReportNetworkError,
  type HazardReportApi,
  type HazardReportHttpError,
} from "../ports/hazard-report-api";
import type { OfflineReportStore } from "../ports/offline-report-store";
import type { PersistedPhoto, PhotoStorage } from "../ports/photo-storage";
import type { StoredReport } from "../types";

/** Predictable ids: 00000000-0000-4000-8000-000000000001, ...002, ... */
export function sequentialIds(): () => string {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

export class FakeGps implements GpsProvider {
  public reading: GpsReading = { status: "OK", latitude: 6.9271, longitude: 79.8612 };
  public failWith: Error | null = null;
  public calls = 0;

  public getCurrentPosition(): Promise<GpsReading> {
    this.calls += 1;
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.reading);
  }
}

export class FakeConnectivity implements ConnectivityProvider {
  private listeners = new Set<(online: boolean) => void>();

  public constructor(public online = true) {}

  public isOnline(): Promise<boolean> {
    return Promise.resolve(this.online);
  }

  public subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public setOnline(online: boolean): void {
    this.online = online;
    this.listeners.forEach((listener) => listener(online));
  }
}

export class FakePhotoStorage implements PhotoStorage {
  public readonly files = new Set<string>();
  public failPersist = false;
  public failRemove = false;

  public persist(sourceUri: string, clientReportId: string): Promise<PersistedPhoto> {
    if (this.failPersist) {
      return Promise.reject(new Error("disk full"));
    }
    const localUri = `file:///documents/${clientReportId}.jpg`;
    this.files.add(localUri);
    return Promise.resolve({ localUri, photoRef: `photo://${clientReportId}.jpg` });
  }

  public remove(localUri: string): Promise<void> {
    if (this.failRemove) {
      return Promise.reject(new Error("cannot delete"));
    }
    this.files.delete(localUri);
    return Promise.resolve();
  }
}

/** Pretends to be the phone's storage. Make a second repository over the same store to "restart the app". */
export class InMemoryOfflineStore implements OfflineReportStore {
  public records: readonly StoredReport[] = [];
  public failWrites = false;
  public writes = 0;

  public read(): Promise<readonly StoredReport[]> {
    return Promise.resolve(this.records);
  }

  public write(reports: readonly StoredReport[]): Promise<void> {
    if (this.failWrites) {
      return Promise.reject(new Error("storage full"));
    }
    this.writes += 1;
    this.records = reports;
    return Promise.resolve();
  }
}

/**
 * A pretend server. It remembers reports by clientReportId (like the real unique index), and it can
 * misbehave on purpose: be unreachable, or save the report but lose the answer.
 */
export class FakeServer implements HazardReportApi {
  public readonly reports = new Map<string, SubmitHazardReportResponse>();
  public readonly submitCalls: { payload: SubmitHazardReportInput; key: string }[] = [];
  public unreachable = false;
  public loseNextResponse = false;
  public rejectWith: HazardReportHttpError | null = null;
  public outsideArea = false;
  public statuses = new Map<string, HazardReportStatusResponse>();
  public statusFails = false;
  private nextId = 1;

  public submit(
    payload: SubmitHazardReportInput,
    idempotencyKey: string,
  ): Promise<SubmitHazardReportResponse> {
    this.submitCalls.push({ payload, key: idempotencyKey });
    if (this.unreachable) {
      return Promise.reject(new HazardReportNetworkError());
    }
    if (this.rejectWith) {
      return Promise.reject(this.rejectWith);
    }
    const existing = this.reports.get(payload.clientReportId);
    const report: SubmitHazardReportResponse = existing ?? {
      reportId: `99999999-9999-4999-8999-${String(this.nextId++).padStart(12, "0")}`,
      clientReportId: payload.clientReportId,
      status: "PENDING",
      hazardType: payload.hazardType,
      outsideAssignedArea: this.outsideArea,
      requiresExtraReview: this.outsideArea,
      submittedAt: "2026-10-05T10:00:00.000Z",
    };
    this.reports.set(payload.clientReportId, report);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      return Promise.reject(new HazardReportNetworkError("connection lost"));
    }
    return Promise.resolve(report);
  }

  public getStatus(reportId: string): Promise<HazardReportStatusResponse> {
    if (this.statusFails) {
      return Promise.reject(new HazardReportNetworkError());
    }
    return Promise.resolve(this.statuses.get(reportId) ?? { reportId, status: "PENDING" });
  }
}

import type { SubmitHazardReportInput } from "@disaster/shared-validation";
import type { OfflineReportStore } from "../ports/offline-report-store";
import type { Acknowledgement, StoredReport } from "../types";

export interface NewPendingReport {
  readonly payload: SubmitHazardReportInput;
  readonly localPhotoUri: string | null;
  readonly createdAt: string;
}

/**
 * The offline queue. Every change is "read, change, write" and the changes are lined up one
 * after another, so two quick calls can never overwrite each other.
 */
export class OfflineReportRepository {
  private chain: Promise<unknown> = Promise.resolve();

  public constructor(private readonly store: OfflineReportStore) {}

  public list(): Promise<readonly StoredReport[]> {
    return this.run(async () => sorted(await this.store.read()));
  }

  public get(clientReportId: string): Promise<StoredReport | null> {
    return this.run(async () => find(await this.store.read(), clientReportId) ?? null);
  }

  /** Saves a report that the server has not confirmed. Re-saving the same ID replaces the old copy. */
  public async savePending(report: NewPendingReport): Promise<StoredReport> {
    const id = report.payload.clientReportId;
    const saved = await this.mutate(id, (existing) => {
      if (existing?.state === "SYNCED") {
        return existing; // already confirmed by the server: never overwrite it
      }
      return {
        clientReportId: id,
        state: "PENDING_SYNC",
        payload: report.payload,
        localPhotoUri: report.localPhotoUri,
        createdAt: existing?.createdAt ?? report.createdAt,
        attempts: 0,
        lastError: null,
        needsAttention: false,
        acknowledgement: null,
      };
    });
    return saved as StoredReport;
  }

  public recordFailure(
    clientReportId: string,
    message: string,
    needsAttention: boolean,
  ): Promise<StoredReport | null> {
    return this.mutate(clientReportId, (existing) => {
      if (!existing) {
        return null;
      }
      return existing.state === "SYNCED"
        ? existing
        : { ...existing, attempts: existing.attempts + 1, lastError: message, needsAttention };
    });
  }

  /** Saves the server's acknowledgement and flips the record to SYNCED in one single write. */
  public markSynchronized(
    clientReportId: string,
    acknowledgement: Acknowledgement,
  ): Promise<StoredReport | null> {
    return this.mutate(clientReportId, (existing) =>
      existing
        ? {
            ...existing,
            state: "SYNCED",
            attempts: existing.attempts + 1,
            lastError: null,
            needsAttention: false,
            acknowledgement,
          }
        : null,
    );
  }

  public clearLocalPhoto(clientReportId: string): Promise<StoredReport | null> {
    return this.mutate(clientReportId, (existing) =>
      existing ? { ...existing, localPhotoUri: null } : null,
    );
  }

  /** Stores a newer server status (read-only information; the phone never decides it). */
  public updateServerStatus(
    clientReportId: string,
    status: Acknowledgement["status"],
    rejectionReason: string | null,
  ): Promise<StoredReport | null> {
    return this.mutate(clientReportId, (existing) => {
      if (!existing) {
        return null;
      }
      return existing.acknowledgement === null
        ? existing
        : {
            ...existing,
            acknowledgement: { ...existing.acknowledgement, status, rejectionReason },
          };
    });
  }

  private mutate(
    clientReportId: string,
    change: (existing: StoredReport | undefined) => StoredReport | null,
  ): Promise<StoredReport | null> {
    return this.run(async () => {
      const all = await this.store.read();
      const existing = find(all, clientReportId);
      const next = change(existing);
      if (next !== null && next !== existing) {
        const others = all.filter((report) => report.clientReportId !== clientReportId);
        await this.store.write([...others, next]);
      }
      return next;
    });
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function find(reports: readonly StoredReport[], clientReportId: string): StoredReport | undefined {
  return reports.find((report) => report.clientReportId === clientReportId);
}

function sorted(reports: readonly StoredReport[]): StoredReport[] {
  return [...reports].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.clientReportId.localeCompare(b.clientReportId),
  );
}

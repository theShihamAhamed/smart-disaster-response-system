import type { ConnectivityProvider } from "../ports/connectivity-provider";
import {
  HazardReportHttpError,
  isRetryableStatus,
  type HazardReportApi,
} from "../ports/hazard-report-api";
import type { OfflineReportRepository } from "../repositories/offline-report-repository";
import type { PhotoRepository } from "../repositories/photo-repository";
import type { Acknowledgement } from "../types";

export type SendOutcome =
  | { readonly kind: "SYNCED"; readonly acknowledgement: Acknowledgement }
  /** No answer or a server problem. The report stays saved and will be tried again. */
  | { readonly kind: "RETRY_LATER"; readonly message: string }
  /** The server refused the report. Retrying alone will not help. */
  | {
      readonly kind: "REJECTED";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
    };

export interface SyncSummary {
  readonly skipped: "OFFLINE" | null;
  readonly synced: readonly string[];
  readonly failed: readonly { readonly clientReportId: string; readonly message: string }[];
  /** Reports still waiting after this run. */
  readonly remaining: number;
}

export interface SyncDependencies {
  readonly api: HazardReportApi;
  readonly repository: OfflineReportRepository;
  readonly photos: PhotoRepository;
  readonly connectivity: ConnectivityProvider;
}

export const SYNC_MESSAGES = {
  offline: "No connection. Your report is saved on this phone and will be sent later.",
  unreachable: "The server could not be reached. Your report is saved and will be retried.",
  missing: "This report could not be found on the phone.",
  refused: "The server could not accept this report. Please check it and send it again.",
} as const;

/** The server clearly refused this report (for example 422), so retrying alone will not help. */
function refusalOf(error: unknown): HazardReportHttpError | null {
  return error instanceof HazardReportHttpError && !isRetryableStatus(error.status) ? error : null;
}

/**
 * Sends saved reports to the server ONE AT A TIME.
 * Golden rule: the server's acknowledgement is saved on the phone FIRST.
 * Only after that is the local photo copy removed. A report is never dropped before that.
 */
export class ReportSyncService {
  private readonly inFlight = new Map<string, Promise<SendOutcome>>();
  private running: Promise<SyncSummary> | null = null;

  public constructor(private readonly deps: SyncDependencies) {}

  /** Sends one saved report. Calling it twice at the same time shares one request. */
  public sendOne(clientReportId: string): Promise<SendOutcome> {
    const existing = this.inFlight.get(clientReportId);
    if (existing) {
      return existing;
    }
    const run = this.send(clientReportId).finally(() => this.inFlight.delete(clientReportId));
    this.inFlight.set(clientReportId, run);
    return run;
  }

  /** Sends everything that is waiting. Overlapping calls share one run. */
  public syncQueue(): Promise<SyncSummary> {
    if (this.running) {
      return this.running;
    }
    const run = this.drain().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async drain(): Promise<SyncSummary> {
    const { repository, connectivity } = this.deps;
    const waiting = (await repository.list()).filter(
      (report) => report.state === "PENDING_SYNC" && !report.needsAttention,
    );

    if (!(await connectivity.isOnline())) {
      return { skipped: "OFFLINE", synced: [], failed: [], remaining: waiting.length };
    }

    const synced: string[] = [];
    const failed: { clientReportId: string; message: string }[] = [];
    let remaining = waiting.length;

    for (const report of waiting) {
      const outcome = await this.sendOne(report.clientReportId);
      if (outcome.kind === "SYNCED") {
        synced.push(report.clientReportId);
        remaining -= 1;
        continue;
      }
      failed.push({ clientReportId: report.clientReportId, message: outcome.message });
      if (outcome.kind === "RETRY_LATER") {
        break; // the connection or server is struggling: keep the rest untouched for next time
      }
    }

    return { skipped: null, synced, failed, remaining };
  }

  private async send(clientReportId: string): Promise<SendOutcome> {
    const { api, repository, photos } = this.deps;
    const report = await repository.get(clientReportId);

    if (report === null) {
      return { kind: "REJECTED", message: SYNC_MESSAGES.missing, fieldErrors: {} };
    }
    if (report.state === "SYNCED" && report.acknowledgement !== null) {
      return { kind: "SYNCED", acknowledgement: report.acknowledgement };
    }

    let response;
    try {
      let payload = report.payload;
      if (report.localPhotoUri !== null && report.payload.photoRef === report.localPhotoUri) {
        const photoRef = await photos.upload(report.localPhotoUri, report.clientReportId);
        payload = { ...report.payload, photoRef };
      }
      response = await api.submit(payload, report.clientReportId);
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) {
        const message = refusal.message || SYNC_MESSAGES.refused;
        await repository.recordFailure(clientReportId, message, true);
        return { kind: "REJECTED", message, fieldErrors: refusal.fieldErrors };
      }
      await repository.recordFailure(clientReportId, SYNC_MESSAGES.unreachable, false);
      return { kind: "RETRY_LATER", message: SYNC_MESSAGES.unreachable };
    }

    const acknowledgement: Acknowledgement = {
      reportId: response.reportId,
      status: response.status,
      outsideAssignedArea: response.outsideAssignedArea,
      requiresExtraReview: response.requiresExtraReview,
      submittedAt: response.submittedAt,
      rejectionReason: null,
    };

    // 1) Save the acknowledgement. 2) Only then clean up the local photo copy.
    await repository.markSynchronized(clientReportId, acknowledgement);
    await this.cleanUpPhoto(clientReportId, report.localPhotoUri);
    return { kind: "SYNCED", acknowledgement };
  }

  private async cleanUpPhoto(clientReportId: string, localPhotoUri: string | null): Promise<void> {
    if (localPhotoUri === null) {
      return;
    }
    await this.deps.photos.discard(localPhotoUri);
    await this.deps.repository.clearLocalPhoto(clientReportId);
  }
}

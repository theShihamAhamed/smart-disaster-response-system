import type { ConnectivityProvider } from "../ports/connectivity-provider";
import type { OfflineReportRepository } from "../repositories/offline-report-repository.ts";
import type { PhotoRepository } from "../repositories/photo-repository.ts";
import type { Acknowledgement, ReportDraft, ReportFieldErrors } from "../types";
import { buildSubmitPayload, validateDraft } from "../validation/report-validation";
import type { ReportSyncService } from "./report-sync-service";

export type SubmissionResult =
  /** Something in the form needs fixing. Nothing was saved. */
  | { readonly kind: "INVALID"; readonly errors: ReportFieldErrors }
  /** The photo or the phone's storage failed, so nothing was saved. */
  | { readonly kind: "NOT_SAVED"; readonly reason: "PHOTO" | "STORAGE"; readonly message: string }
  /** The server confirmed the report -> shown as "Pending Verification". */
  | { readonly kind: "SUBMITTED"; readonly acknowledgement: Acknowledgement }
  /** Saved on the phone, waiting for a connection -> shown as "Pending Sync". */
  | {
      readonly kind: "QUEUED";
      readonly clientReportId: string;
      readonly reason: "OFFLINE" | "SERVER_UNREACHABLE";
    }
  /** The server refused the report. The draft is kept so the user can fix it. */
  | {
      readonly kind: "SERVER_REJECTED";
      readonly message: string;
      readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
    };

export interface SubmissionDependencies {
  readonly repository: OfflineReportRepository;
  readonly photos: PhotoRepository;
  readonly sync: ReportSyncService;
  readonly connectivity: ConnectivityProvider;
  readonly now?: () => Date;
}

export const SUBMISSION_MESSAGES = {
  photo: "We could not save your photo on this phone. Please pick it again.",
  storage: "We could not save your report on this phone. Free some space and try again.",
} as const;

/**
 * Turns a finished draft into a saved report and sends it.
 * The report is saved on the phone BEFORE any network call, so a crash, a timeout or a lost
 * answer can never lose it, and the same clientReportId is used every time.
 */
export class ReportSubmissionService {
  private readonly inFlight = new Map<string, Promise<SubmissionResult>>();

  public constructor(private readonly deps: SubmissionDependencies) {}

  /** Tapping "Submit" twice shares one submission instead of sending two. */
  public submit(draft: ReportDraft): Promise<SubmissionResult> {
    const existing = this.inFlight.get(draft.clientReportId);
    if (existing) {
      return existing;
    }
    const run = this.run(draft).finally(() => this.inFlight.delete(draft.clientReportId));
    this.inFlight.set(draft.clientReportId, run);
    return run;
  }

  private async run(draft: ReportDraft): Promise<SubmissionResult> {
    const { repository, photos, sync, connectivity } = this.deps;
    const now = this.deps.now ?? (() => new Date());

    const validation = validateDraft(draft);
    if (!validation.ok) {
      return { kind: "INVALID", errors: validation.errors };
    }

    let persisted;
    try {
      persisted = await photos.persist(validation.photoUri, draft.clientReportId);
    } catch {
      return { kind: "NOT_SAVED", reason: "PHOTO", message: SUBMISSION_MESSAGES.photo };
    }

    try {
      await repository.savePending({
        payload: buildSubmitPayload(draft, persisted.photoRef),
        localPhotoUri: persisted.localUri,
        createdAt: now().toISOString(),
      });
    } catch {
      return { kind: "NOT_SAVED", reason: "STORAGE", message: SUBMISSION_MESSAGES.storage };
    }

    if (!(await connectivity.isOnline())) {
      return { kind: "QUEUED", clientReportId: draft.clientReportId, reason: "OFFLINE" };
    }

    const outcome = await sync.sendOne(draft.clientReportId);
    switch (outcome.kind) {
      case "SYNCED":
        return { kind: "SUBMITTED", acknowledgement: outcome.acknowledgement };
      case "RETRY_LATER":
        return {
          kind: "QUEUED",
          clientReportId: draft.clientReportId,
          reason: "SERVER_UNREACHABLE",
        };
      case "REJECTED":
        return {
          kind: "SERVER_REJECTED",
          message: outcome.message,
          fieldErrors: outcome.fieldErrors,
        };
    }
  }
}

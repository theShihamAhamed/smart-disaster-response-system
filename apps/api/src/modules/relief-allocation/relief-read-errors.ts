export type ReliefReadErrorCode =
  | "RELIEF_REQUEST_NOT_FOUND"
  | "RELIEF_DATA_INTEGRITY_ERROR"
  | "STOCK_LEDGER_UNAVAILABLE"
  | "RELIEF_READ_UNAVAILABLE";

export class ReliefReadError extends Error {
  public constructor(
    public readonly code: ReliefReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReliefReadError";
  }
}

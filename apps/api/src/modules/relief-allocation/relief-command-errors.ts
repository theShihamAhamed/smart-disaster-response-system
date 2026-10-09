export type ReliefCommandErrorCode =
  | "ALLOCATION_NOT_FOUND"
  | "IDEMPOTENCY_MISMATCH"
  | "INVALID_ALLOCATION_COMMAND"
  | "RELIEF_REQUEST_NOT_FOUND"
  | "REQUEST_ALREADY_ALLOCATED"
  | "REQUEST_CHANGED"
  | "STOCK_CHANGED"
  | "PARTNER_REQUIRED"
  | "TEAM_UNAVAILABLE"
  | "ALLOCATION_DATA_INTEGRITY_ERROR"
  | "ALLOCATION_DEPENDENCY_UNAVAILABLE"
  | "ALLOCATION_TRANSACTION_NOT_AVAILABLE";

export class ReliefCommandError extends Error {
  public constructor(
    public readonly code: ReliefCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReliefCommandError";
  }
}

export interface PersistedPhoto {
  /** Where the permanent copy lives on the phone. */
  readonly localUri: string;
  /** The reference that is sent to the server as `photoRef`. */
  readonly photoRef: string;
}

/** Port: keeps a permanent copy of the photo so it survives app restarts. */
export interface PhotoStorage {
  persist(sourceUri: string, clientReportId: string): Promise<PersistedPhoto>;
  remove(localUri: string): Promise<void>;
}

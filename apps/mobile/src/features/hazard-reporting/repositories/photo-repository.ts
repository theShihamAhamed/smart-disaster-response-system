import type { PersistedPhoto, PhotoStorage } from "../ports/photo-storage";

export class PhotoPersistenceError extends Error {
  public constructor(message = "The photo could not be saved on this phone.") {
    super(message);
    this.name = "PhotoPersistenceError";
  }
}

/** Wraps the photo storage so callers only ever see one kind of failure. */
export class PhotoRepository {
  public constructor(private readonly storage: PhotoStorage) {}

  public async persist(sourceUri: string, clientReportId: string): Promise<PersistedPhoto> {
    try {
      return await this.storage.persist(sourceUri, clientReportId);
    } catch {
      throw new PhotoPersistenceError();
    }
  }

  /** Best effort: a leftover file is harmless, so this never throws. */
  public async discard(localUri: string): Promise<void> {
    try {
      await this.storage.remove(localUri);
    } catch {
      // ignored on purpose
    }
  }
}

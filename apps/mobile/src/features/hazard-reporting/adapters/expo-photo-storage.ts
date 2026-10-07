import * as FileSystem from "expo-file-system/legacy";

function baseDir(): string {
  const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("No writable storage folder is available on this phone.");
  }
  return `${dir}hazard-photos/`;
}

export const expoPhotoStorage = {
  async persist(sourceUri: string, clientReportId: string) {
    const folder = baseDir();
    try {
      const info = await FileSystem.getInfoAsync(folder);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      }
      const target = `${folder}${clientReportId}.jpg`;
      await FileSystem.copyAsync({ from: sourceUri, to: target });
      return { localUri: target, photoRef: target };
    } catch (error) {
      console.warn("[photo-storage] copy failed:", error);
      throw error;
    }
  },

  async remove(uri: string): Promise<void> {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};

export type GpsReading =
  | { readonly status: "OK"; readonly latitude: number; readonly longitude: number }
  | { readonly status: "PERMISSION_DENIED" }
  | { readonly status: "UNAVAILABLE" };

/** Port: the phone's GPS. The real one (expo-location) is plugged in later. */
export interface GpsProvider {
  getCurrentPosition(): Promise<GpsReading>;
}

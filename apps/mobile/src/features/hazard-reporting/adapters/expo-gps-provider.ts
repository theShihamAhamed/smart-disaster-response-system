import * as Location from "expo-location";

export const expoGpsProvider = {
  async requestPermission(): Promise<boolean> {
    const result = await Location.requestForegroundPermissionsAsync();
    return result.status === "granted";
  },

  async getCurrentPosition() {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      status: "OK" as const,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  },
};

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ManualMapPin } from "./ManualMapPin";
import { colors, radius } from "../../../theme";

type Coords = { latitude: number; longitude: number };

type Props = {
  location: (Coords & { source?: string }) | null;
  pendingPin: Coords | null;
  gpsMessage: string | null;
  showManualMap: boolean;
  error?: string;
  onUseGps: () => void;
  onOpenManual: () => void;
  onPlacePin: (lat: number, lng: number) => void;
  onConfirmPin: () => void;
};

export function LocationSelector(p: Props) {
  return (
    <View>
      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={p.onUseGps}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>📍 Use my GPS location</Text>
      </Pressable>

      {p.gpsMessage ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>{p.gpsMessage}</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        onPress={p.onOpenManual}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>🗺️ Place a pin on the map instead</Text>
      </Pressable>

      {p.showManualMap ? (
        <ManualMapPin pendingPin={p.pendingPin} onPlace={p.onPlacePin} onConfirm={p.onConfirmPin} />
      ) : null}

      {p.location ? (
        <View style={styles.okBox}>
          <Text style={styles.okTitle}>Location set ({p.location.source ?? "GPS"})</Text>
          <Text style={styles.okText}>
            {p.location.latitude}, {p.location.longitude}
          </Text>
        </View>
      ) : null}
      {p.error ? <Text style={styles.error}>{p.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  primaryBtn: {
    backgroundColor: colors.primary,
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  secondaryBtn: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
  pressed: { opacity: 0.75 },
  warnBox: {
    backgroundColor: colors.warnSoft,
    padding: 12,
    borderRadius: radius.sm,
    marginTop: 10,
  },
  warnText: { color: colors.warn, fontWeight: "600" },
  okBox: {
    backgroundColor: colors.successSoft,
    padding: 12,
    borderRadius: radius.sm,
    marginTop: 12,
  },
  okTitle: { color: colors.success, fontWeight: "800" },
  okText: { color: colors.text, marginTop: 2 },
  error: { color: colors.danger, marginTop: 8, fontWeight: "600" },
});

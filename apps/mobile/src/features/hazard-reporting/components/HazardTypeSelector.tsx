import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../../../theme";

const TYPES = [
  { key: "FLOOD", icon: "🌊", label: "Flood" },
  { key: "LANDSLIDE", icon: "⛰️", label: "Landslide" },
  { key: "CYCLONE", icon: "🌀", label: "Cyclone" },
  { key: "DROUGHT", icon: "☀️", label: "Drought" },
] as const;

type Props = { value: string | null; error?: string; onChange: (t: string) => void };

export function HazardTypeSelector({ value, error, onChange }: Props) {
  return (
    <View>
      <View style={styles.grid}>
        {TYPES.map((t) => {
          const active = value === t.key;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              accessibilityLabel={`Hazard type ${t.key}`}
              accessibilityState={{ selected: active }}
              onPress={() => onChange(t.key)}
              style={({ pressed }) => [
                styles.tile,
                active && styles.tileActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.icon}>{t.icon}</Text>
              <Text style={[styles.label, active && styles.labelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    width: "48%",
    minHeight: 84,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tileActive: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  pressed: { opacity: 0.75 },
  icon: { fontSize: 28 },
  label: { fontSize: 15, fontWeight: "600", color: colors.text },
  labelActive: { color: colors.danger, fontWeight: "800" },
  error: { color: colors.danger, marginTop: 8, fontWeight: "600" },
});

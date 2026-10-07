import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../../theme";

type Props = {
  hazardType: string | null;
  description: string;
  hasPhoto: boolean;
  location: { latitude: number; longitude: number } | null;
};

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, !ok && styles.missing]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function ReportReview({ hazardType, description, hasPhoto, location }: Props) {
  return (
    <View>
      <Row label="Hazard" value={hazardType ?? "Not chosen"} ok={Boolean(hazardType)} />
      <Row
        label="Location"
        value={location ? `${location.latitude}, ${location.longitude}` : "Missing"}
        ok={Boolean(location)}
      />
      <Row label="Photo" value={hasPhoto ? "Added" : "Missing"} ok={hasPhoto} />
      <Row
        label="Details"
        value={description.trim() || "Missing"}
        ok={description.trim().length >= 10}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  label: { color: colors.muted, fontWeight: "600" },
  value: { color: colors.text, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  missing: { color: colors.danger },
});

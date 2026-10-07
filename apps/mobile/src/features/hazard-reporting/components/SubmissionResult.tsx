import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadow } from "../../../theme";

type Props = { message: string; tone: string; onNewReport: () => void };

export function SubmissionResult({ message, tone, onNewReport }: Props) {
  const bad = tone === "bad";
  const waiting = tone === "waiting";
  const circleColor = bad ? colors.danger : waiting ? colors.warn : colors.success;
  const icon = bad ? "!" : waiting ? "…" : "✓";
  const title = bad ? "Not sent" : waiting ? "Saved on this phone" : "Report received";

  return (
    <View style={styles.box}>
      <View style={[styles.circle, { backgroundColor: circleColor }]}>
        <Text style={styles.tick}>{icon}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.msg}>{message}</Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.75 }]}
        onPress={onNewReport}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>{bad ? "Try again" : "Report another hazard"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.card,
    padding: 22,
    borderRadius: radius.lg,
    marginBottom: 14,
    alignItems: "center",
    ...shadow,
  },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  tick: { color: "#fff", fontSize: 32, fontWeight: "800" },
  title: { fontWeight: "800", fontSize: 20, color: colors.text, marginBottom: 6 },
  msg: { color: colors.muted, textAlign: "center", marginBottom: 16, fontSize: 15 },
  button: {
    alignSelf: "stretch",
    minHeight: 52,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});

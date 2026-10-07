import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "../../../theme";

type Props = { value: string; error?: string; onChange: (t: string) => void };

export function DescriptionField({ value, error, onChange }: Props) {
  const length = value.trim().length;
  const good = length >= 10 && length <= 500;
  return (
    <View>
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        multiline
        value={value}
        onChangeText={onChange}
        placeholder="Example: Water is rising fast near the main bridge."
        placeholderTextColor="#94A3B8"
        maxLength={600}
        accessibilityLabel="Hazard description"
      />
      <Text style={[styles.count, good && styles.countGood]}>{length} / 500 (minimum 10)</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 110,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: "#F8FAFC",
    textAlignVertical: "top",
  },
  inputError: { borderColor: colors.danger },
  count: { textAlign: "right", color: colors.muted, marginTop: 6 },
  countGood: { color: colors.success, fontWeight: "700" },
  error: { color: colors.danger, marginTop: 6, fontWeight: "600" },
});

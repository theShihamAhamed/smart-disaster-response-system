import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../../theme';

type Props = { statusText: string | null; canRefresh: boolean; onRefresh: () => void };

export function ReportStatusCard({ statusText, canRefresh, onRefresh }: Props) {
  if (!canRefresh) return null;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Report status (read only)</Text>
      <Text style={styles.status}>{statusText ?? 'Not checked yet'}</Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.75 }]}
        onPress={onRefresh}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Refresh status</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.infoSoft, padding: 16, borderRadius: radius.lg, marginBottom: 14, gap: 8 },
  title: { fontWeight: '800', color: colors.info },
  status: { fontSize: 16, color: colors.text, fontWeight: '600' },
  button: {
    minHeight: 48,
    backgroundColor: colors.info,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '800' },
});
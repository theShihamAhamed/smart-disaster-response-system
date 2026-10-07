import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadow } from "../../../theme";

type Props = {
  step: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
};

export function StepCard({ step, title, done, children }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [opacity]);

  return (
    <Animated.View style={[styles.card, { opacity }]}>
      <View style={styles.header}>
        <View style={[styles.badge, done && styles.badgeDone]}>
          <Text style={styles.badgeText}>{done ? "✓" : step}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 14,
    ...shadow,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 10 },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.navySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDone: { backgroundColor: colors.success },
  badgeText: { color: "#fff", fontWeight: "800" },
  title: { fontSize: 17, fontWeight: "700", color: colors.text, flex: 1 },
});

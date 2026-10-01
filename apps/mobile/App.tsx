import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { getMobileShellCopy } from "./src/shell";

export default function App() {
  const copy = getMobileShellCopy();
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SE3070 Assignment 02</Text>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>
      <View style={styles.notice}>
        <Text style={styles.noticeText}>{copy.phaseNotice}</Text>
      </View>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    backgroundColor: "#eef4f1",
  },
  eyebrow: {
    color: "#22694f",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 12,
    color: "#10231d",
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 44,
  },
  subtitle: {
    marginTop: 14,
    color: "#466158",
    fontSize: 18,
    lineHeight: 26,
  },
  notice: {
    marginTop: 32,
    padding: 18,
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  noticeText: {
    color: "#314a41",
    fontSize: 15,
    lineHeight: 22,
  },
});

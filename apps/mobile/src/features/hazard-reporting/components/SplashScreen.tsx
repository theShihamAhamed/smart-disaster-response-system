import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={require("../../../../assets/logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Disaster Coordination logo"
      />
      <Text style={styles.title}>Disaster Coordination</Text>
      <Text style={styles.subtitle}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020B18",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 220, height: 220 },
  title: { color: "#ffffff", fontSize: 22, fontWeight: "800", marginTop: 16 },
  subtitle: { color: "#94a3b8", marginTop: 6 },
});

import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors, radius } from "../../../theme";

type Props = { photoUri: string | null; error?: string; onPicked: (uri: string) => void };

export function PhotoPicker({ photoUri, error, onPicked }: Props) {
  async function fromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]) onPicked(result.assets[0].uri);
  }

  async function fromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) onPicked(result.assets[0].uri);
  }

  return (
    <View>
      {photoUri ? (
        <Image
          source={{ uri: photoUri }}
          style={styles.preview}
          accessibilityLabel="Photo preview"
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>No photo yet</Text>
        </View>
      )}
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          onPress={fromCamera}
        >
          <Text style={styles.btnText}>{photoUri ? "Retake" : "Take photo"}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.btnAlt, pressed && styles.pressed]}
          onPress={fromLibrary}
        >
          <Text style={styles.btnAltText}>{photoUri ? "Replace" : "Choose photo"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { width: "100%", height: 200, borderRadius: radius.md, marginBottom: 10 },
  empty: {
    height: 120,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  emptyIcon: { fontSize: 30 },
  emptyText: { color: colors.muted, marginTop: 4 },
  row: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    minHeight: 50,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#fff", fontWeight: "800" },
  btnAlt: {
    flex: 1,
    minHeight: 50,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  btnAltText: { color: colors.primary, fontWeight: "800" },
  pressed: { opacity: 0.75 },
  error: { color: colors.danger, marginTop: 8, fontWeight: "600" },
});

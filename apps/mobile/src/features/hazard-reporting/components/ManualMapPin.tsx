import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { colors, radius } from "../../../theme";

type Props = {
  pendingPin: { latitude: number; longitude: number } | null;
  onPlace: (latitude: number, longitude: number) => void;
  onConfirm: () => void;
};

const MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map').setView([7.8731, 80.7718], 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    var marker = null;
    map.on('click', function (e) {
      var lat = Number(e.latlng.lat.toFixed(6));
      var lng = Number(e.latlng.lng.toFixed(6));
      if (marker) { marker.setLatLng(e.latlng); }
      else { marker = L.marker(e.latlng).addTo(map); }
      window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: lat, longitude: lng }));
    });
  </script>
</body>
</html>
`;

export function ManualMapPin({ pendingPin, onPlace, onConfirm }: Props) {
  function handleMessage(event: WebViewMessageEvent) {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { latitude: number; longitude: number };
      onPlace(data.latitude, data.longitude);
    } catch {
      // ignore bad messages
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.help}>Tap the map where the hazard is. Zoom with two fingers.</Text>

      <View style={styles.mapBox}>
        <WebView
          originWhitelist={["*"]}
          source={{ html: MAP_HTML }}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          nestedScrollEnabled
          style={styles.map}
        />
      </View>

      {pendingPin ? (
        <>
          <Text style={styles.coords}>
            Pin: {pendingPin.latitude}, {pendingPin.longitude}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.confirm, pressed && { opacity: 0.75 }]}
            onPress={onConfirm}
            accessibilityRole="button"
          >
            <Text style={styles.confirmText}>✓ Confirm this pin</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  help: { marginBottom: 8, color: colors.muted },
  mapBox: {
    height: 360,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.primary,
  },
  map: { flex: 1 },
  coords: { marginTop: 10, textAlign: "center", color: colors.text, fontWeight: "600" },
  confirm: {
    marginTop: 8,
    minHeight: 52,
    backgroundColor: colors.success,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});

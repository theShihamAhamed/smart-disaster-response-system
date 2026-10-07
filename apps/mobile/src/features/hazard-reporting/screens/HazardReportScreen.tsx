import React from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useHazardReport } from "../hooks/use-hazard-report";
import { HazardTypeSelector } from "../components/HazardTypeSelector";
import { LocationSelector } from "../components/LocationSelector";
import { PhotoPicker } from "../components/PhotoPicker";
import { DescriptionField } from "../components/DescriptionField";
import { ReportReview } from "../components/ReportReview";
import { SubmissionResult } from "../components/SubmissionResult";
import { ReportStatusCard } from "../components/ReportStatusCard";
import { StepCard } from "../components/StepCard";
import { colors, radius } from "../../../theme";

export function HazardReportScreen() {
  const r = useHazardReport();
  const d = r.draft;

  const doneType = Boolean(d.hazardType);
  const doneLocation = Boolean(d.location);
  const donePhoto = Boolean(d.photoUri);
  const doneText = (d.description ?? "").trim().length >= 10;
  const doneCount = [doneType, doneLocation, donePhoto, doneText].filter(Boolean).length;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Image source={require("../../../../assets/logo.png")} style={styles.logo} />
        <View style={styles.headerText}>
          <Text style={styles.title}>Report a Hazard</Text>
          <Text style={styles.subtitle}>Your report helps responders reach people faster</Text>
        </View>
      </View>

      {!r.resultText ? (
        <View style={styles.progressWrap}>
          <View style={styles.segments}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.segment, i < doneCount && styles.segmentOn]} />
            ))}
          </View>
          <Text style={styles.progressText}>{doneCount} of 4 steps done</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {r.resultText ? (
          <>
            <SubmissionResult
              message={r.resultText}
              tone={r.resultTone}
              onNewReport={r.startNewReport}
            />
            <ReportStatusCard
              statusText={r.statusText}
              canRefresh={Boolean(r.lastServerReportId)}
              onRefresh={r.refreshStatus}
            />
          </>
        ) : (
          <>
            <StepCard step={1} title="What kind of hazard?" done={doneType}>
              <HazardTypeSelector
                value={d.hazardType}
                {...(r.errors.hazardType ? { error: r.errors.hazardType } : {})}
                onChange={r.chooseHazard}
              />
            </StepCard>

            <StepCard step={2} title="Where is it?" done={doneLocation}>
              <LocationSelector
                location={d.location}
                pendingPin={d.pendingPin}
                gpsMessage={r.gpsMessage}
                showManualMap={r.showManualMap}
                {...(r.errors.location ? { error: r.errors.location } : {})}
                onUseGps={r.useGps}
                onOpenManual={() => r.setShowManualMap(true)}
                onPlacePin={r.dropPin}
                onConfirmPin={r.acceptPin}
              />
            </StepCard>

            <StepCard step={3} title="Add one photo" done={donePhoto}>
              <PhotoPicker
                photoUri={d.photoUri}
                {...(r.errors.photo ? { error: r.errors.photo } : {})}
                onPicked={r.choosePhoto}
              />
            </StepCard>

            <StepCard step={4} title="Describe what you see" done={doneText}>
              <DescriptionField
                value={d.description}
                {...(r.errors.description ? { error: r.errors.description } : {})}
                onChange={r.changeDescription}
              />
            </StepCard>

            <StepCard step={5} title="Review" done={doneCount === 4}>
              <ReportReview
                hazardType={d.hazardType}
                description={d.description}
                hasPhoto={donePhoto}
                location={d.location}
              />
            </StepCard>

            <Pressable
              style={({ pressed }) => [
                styles.submit,
                r.submitting && styles.submitDisabled,
                pressed && { opacity: 0.85 },
              ]}
              onPress={r.submit}
              disabled={r.submitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: r.submitting }}
            >
              {r.submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Submit report</Text>
              )}
            </Pressable>
            <Text style={styles.note}>
              No internet? Your report is saved on this phone and sent automatically later.
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.navy,
    paddingTop: 52,
    paddingBottom: 18,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  headerText: { flex: 1 },
  logo: { width: 52, height: 52, borderRadius: 26 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  subtitle: { color: "#93C5FD", marginTop: 2, fontSize: 13 },
  progressWrap: { paddingHorizontal: 18, paddingTop: 14, backgroundColor: colors.bg },
  segments: { flexDirection: "row", gap: 6 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
  segmentOn: { backgroundColor: colors.success },
  progressText: { color: colors.muted, marginTop: 6, fontSize: 12, fontWeight: "600" },
  container: { padding: 16, paddingBottom: 48 },
  submit: {
    minHeight: 58,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  note: { color: colors.muted, textAlign: "center", marginTop: 10, fontSize: 13 },
});

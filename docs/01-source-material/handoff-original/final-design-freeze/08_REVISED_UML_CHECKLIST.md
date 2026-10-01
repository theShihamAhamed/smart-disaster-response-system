# Revised UML Checklist

## High-level use-case diagram

Keep these business use cases and actors:

- Citizen and Community Volunteer -> Submit Citizen Hazard Report.
- DMC Duty Officer -> Verify Hazard Report.
- DMC Duty Officer -> Broadcast Hazard Alert.
- District Officer -> Allocate Relief Resources.
- Map or GPS Service supports Capture GPS Location.
- Push Notification Service and SMS Gateway support broadcasting.

Relationships:

- `Capture GPS Location` remains included by submission.
- `Queue for Offline Sync` remains conditional extension behavior for submission.
- `Escalate to Official Warning` extends verification only when the report is `VERIFIED`.
- `Determine Target Zone` remains included by broadcasting.
- `Trigger SMS Fallback` extends broadcasting only after push failure.
- `Check Shelter Capacity` should be renamed or clarified as `Review Shelter Need and Capacity`; it supplies ranking information and must not imply occupancy mutation.

Do not merge Submit and Verify into one use-case ellipse.

## Class diagram corrections

Add or revise:

- `HazardReport.clientReportId`, `outsideAssignedArea`, `requiresExtraReview`.
- `Location.source`.
- `VerificationDecision` with one-to-one final decision relationship to `HazardReport`.
- `Alert.status`, `sourceReportId`, `createdByOfficerId`, `safetyInstructions`, `version`, `parentAlertId`.
- `AlertTargetZone`, `NotificationDelivery`, `BroadcastAudit`.
- `ReliefRequest`, `ReliefRequestItem`, `WarehouseStock`, `ResourceAllocation`, `AllocationItem`, `DistributionLog`, `PartnerResupplyRequest`, `TransportDispatch`.
- Explicit enums from document 02.

Remove or replace:

- `DMCOfficer.verifyReport(reportID, decision: ReportStatus): Boolean` as the sole verification model; use a decision operation that produces `VerificationDecision`.
- `DistrictOfficer.allocateResources(...): Boolean` as an unstructured direct mutation; use an application operation returning an allocation receipt.
- `DistrictOfficer.updateShelterOccupancy(...)` from the allocation flow.
- Direct responsibility for stock logging inside a generic `ReliefSupply` class; use `WarehouseStock` plus distribution records.
- Numeric trust score unless separately justified; the frozen model uses flags.

Required multiplicities:

```text
Reporter 1 -> 0..* HazardReport
HazardReport 1 -> 0..1 VerificationDecision
HazardReport 1 -> 0..1 initial Alert
Alert 1 -> 1..* AlertTargetZone
Alert 1 -> 0..* NotificationDelivery
Alert 1 -> 0..* BroadcastAudit
Shelter 1 -> 0..* ReliefRequest
ReliefRequest 1 -> 1..* ReliefRequestItem
ReliefRequest 1 -> 0..* ResourceAllocation
ResourceAllocation 1 -> 1..* AllocationItem when stock is allocated
AllocationItem 1 -> 1 DistributionLog
ReliefRequest 1 -> 0..* PartnerResupplyRequest
ResourceAllocation 1 -> 0..1 TransportDispatch
RescueTeam 1 -> 0..* TransportDispatch over time
```

## Sequence diagram requirements

### Submit Citizen Hazard Report

- required-field validation before report creation;
- GPS success versus manual pin;
- citizen versus volunteer outside-area validation;
- online server acknowledgement versus local offline queue;
- per-report synchronization loop;
- delete local record only after acknowledgement;
- same `clientReportId` on every retry.

### Verify Hazard Report

- retrieve full core evidence;
- evidence-load error keeps `PENDING`;
- verify and reject branches;
- rejection reason passed and stored;
- state/version recheck;
- atomic decision plus report-state save;
- already-processed conflict;
- verified-only escalation creating `DRAFT` alert.

### Broadcast Hazard Alert

- load verified source or existing draft;
- form validation, target selection and preview;
- similar-active-alert check;
- save-draft and confirm-send branches;
- activation transaction and audit;
- separate notification-delivery states;
- push retry and SMS fallback;
- replacement version and supersede order;
- active cancellation and All Clear.

### Allocate Relief Resources

Follow the exact revised sequence specification in document 03. Explicitly show transaction, loops, conflicts, resupply, optional dispatch, rollback and idempotent receipt. Never show shelter occupancy being updated.

## Wireframe and screenshot consistency

- Mobile shows Pending Sync separately from Pending Verification.
- Verification UI begins with no decision selected and labels extra-review information as advisory.
- Broadcast UI separates alert state from delivery progress.
- Relief UI shows occupancy as read-only, exposes per-item shortage and requires partner selection.
- Every UI validation shown in wireframes must exist in code and tests.


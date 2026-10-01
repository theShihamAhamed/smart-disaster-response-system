# Submit Citizen Hazard Report Final Component Plan

## Member and assignment scope

**Member:** Eshan L W R  
**Registration number:** IT23857308  
**Assigned substantial use case:** Submit Citizen Hazard Report  
**Primary actors:** Citizen and Community Volunteer  
**Application:** Separate React Native mobile application

Eshan owns only the submission use case. Officer verification, rejection, `VerificationDecision` and escalation belong to Javahir. Eshan may display the later report status to the reporter, but must not implement the decision workflow.

## Rubric target

For the highest individual marks, implement every frozen main, alternate and error flow end to end; keep the mobile UI consistent with the revised storyboard/wireframes; write clean, structured and maintainable code; apply SOLID principles and suitable patterns; avoid code smells; and exceed 80 percent meaningful test coverage with positive, negative, edge and error cases.

## Original Group 050 design to preserve

- A citizen or community volunteer can submit a ground hazard report.
- Supported hazard types are `FLOOD`, `LANDSLIDE`, `CYCLONE` and `DROUGHT`.
- The app captures GPS automatically.
- If GPS fails, the reporter can choose and confirm a manual map pin.
- A photo and short description are required.
- A successful online report enters the DMC queue as `PENDING`.
- Offline submission is stored locally and synchronized later.
- An outside-area volunteer report is accepted and marked for closer review.
- The mobile UI shows a clear submission or pending-sync result.

These are sound, domain-specific behaviors and must not be replaced.

## Problems, corrections and justifications

| ID | Problem in the Group 050 design | Final correction | Justification |
| --- | --- | --- | --- |
| SUB-01 | The sequence calls `dequeueAll()` before each server acknowledgement. A failed sync can lose reports. | Read queued records without deleting them. Synchronize one at a time and remove a local record only after storing the server acknowledgement. | Preserves reports during unstable connectivity and directly strengthens the original offline requirement. |
| SUB-02 | Retrying a queued or uncertain submission can create duplicate server reports. | Generate a stable UUID `clientReportId` when the mobile draft is created. Reuse it for every retry. Enforce uniqueness on the server and return the existing report for a repeated key. | Makes retries idempotent without introducing complex infrastructure. |
| SUB-03 | `QUEUED_OFFLINE` is mixed into the central report lifecycle. | Treat Pending Sync or `QUEUED_OFFLINE` as a mobile-local synchronization state. The central database creates the report as `PENDING` only after acknowledgement. | Separates device synchronization from officer verification state. |
| SUB-04 | The original text refers to a lower trust score, but no scoring method or class is defined. | Store `outsideAssignedArea` and `requiresExtraReview` booleans. Do not calculate a numeric score. | Preserves the intended closer review while avoiding an arbitrary, unsupported algorithm. |
| SUB-05 | Required evidence rules can diverge between scenario, mobile screen, API and tests. | Require one photo, a 10-500 character trimmed description, a supported hazard type and a valid GPS or confirmed manual location in every layer. | The rubric rewards clear alignment between design, implementation and UX. |
| SUB-06 | GPS fallback does not record whether coordinates came from GPS or a manual pin. | Add `LocationSource = GPS | MANUAL`. | Makes the fallback auditable and allows the verification UI to explain the source. |
| SUB-07 | The sequence lets actor classes create reports directly and mixes UI, offline storage and domain responsibilities. | Use a mobile form/controller, local offline repository, sync service and API client. Keep validation and report rules in focused services/value objects. | Improves maintainability, SOLID compliance and testability. |
| SUB-08 | The original confirmation is ambiguous when the device is offline. | Show distinct states: `Pending Sync` locally and `Pending Verification` after server acknowledgement. | Gives the reporter accurate feedback and follows HCI visibility-of-system-status principles. |
| SUB-09 | Photo upload/storage failure is not clearly separated from no-network queueing. | If the complete report payload can be stored locally, keep it queued. If required photo persistence fails locally, block submission and show a field-level error. | Prevents incomplete evidence from reaching the verification queue. |
| SUB-10 | The original design does not define duplicate button taps. | Disable the submit button while processing and reuse the same `clientReportId` for any safe retry. | Prevents duplicate UI actions and supports server idempotency. |

## Final use-case scenario

### Preconditions

- The mobile app is installed.
- Camera/photo-library and location permission have been requested.
- The actor is a citizen or volunteer.
- A volunteer profile contains an assigned area.

### Main online flow

1. The reporter opens Report Hazard.
2. The app requests the current GPS location.
3. The reporter selects a hazard type.
4. The reporter attaches exactly one photo.
5. The reporter enters a 10-500 character description.
6. The app validates all fields and shows a review summary.
7. The reporter submits once.
8. The app sends the payload with a stable `clientReportId`.
9. The server validates the payload and detects whether a volunteer is outside the assigned area.
10. The server creates one `PENDING` report and acknowledges it.
11. The app stores the acknowledgement and displays `Pending Verification` with the report ID.

### GPS unavailable flow

1. GPS returns no fix or permission is unavailable.
2. Show a clear Location Not Found message.
3. Allow the reporter to place a manual map pin.
4. Require confirmation of the pin.
5. Continue with `locationSource=MANUAL`.

### Offline flow

1. The reporter completes and validates the same required fields.
2. Network is unavailable when submitting.
3. Save the complete payload locally with `Pending Sync` and its `clientReportId`.
4. When connectivity returns, the sync worker reads one queued record and sends it.
5. On failure or uncertain response, retain the local record and retry with the same ID.
6. On server acknowledgement, store the server report ID and then remove/mark the local queue record as synchronized.
7. Display `Pending Verification`.

### Volunteer outside assigned area

- Accept the report.
- Set `outsideAssignedArea=true` and `requiresExtraReview=true`.
- Do not block submission and do not show an accusatory warning to the volunteer.

## Final business rules

- Only citizens and volunteers may submit through this mobile flow.
- One photo, one location, hazard type and description are mandatory.
- Description length is 10-500 trimmed characters.
- Coordinates must fall in valid latitude and longitude ranges.
- GPS is preferred; a confirmed manual pin is valid.
- A stable `clientReportId` is created before the first submission attempt.
- The same logical report always reuses the same `clientReportId`.
- The server stores at most one report for a `clientReportId`.
- A queued report remains locally recoverable until server acknowledgement.
- A successful server record begins at `PENDING`.
- The mobile client never sets `VERIFIED` or `REJECTED`.
- Outside-area volunteer reports are accepted and flagged for extra review.
- Technical messages must be translated into understandable user messages.

## States

Mobile-local states:

```text
DRAFT -> PENDING_SYNC -> PENDING_VERIFICATION
DRAFT -> PENDING_VERIFICATION when online acknowledgement succeeds
```

Server state created by this component:

```text
PENDING
```

`VERIFIED` and `REJECTED` are later read-only outcomes from Javahir's component.

## Required data and domain objects

- `Reporter`: ID, role and assigned area for volunteers.
- `HazardReport`: server ID, unique `clientReportId`, reporter ID, hazard type, description, photo reference, location, submission time, `PENDING`, outside-area flag and extra-review flag.
- `Location`: latitude, longitude, district/address if resolved, and `GPS` or `MANUAL` source.
- `OfflineReport`: mobile-only payload, local state, attempt information and last error.
- `ReportPhoto`: a local URI before synchronization and a persistent object reference after upload.

## Required application operations

- `createReportDraft()` generates the stable client ID.
- `validateReportDraft()` validates all evidence consistently.
- `captureGpsLocation()` returns a valid location or the manual-pin path.
- `queueOfflineReport()` persists the complete valid payload.
- `submitHazardReport()` sends the idempotent request.
- `syncQueuedReports()` processes records individually and acknowledges before removal.
- `getOwnReportStatus()` displays the later server outcome without implementing verification.

## UI flow and HCI requirements

- Keep the mobile flow short: location, hazard type, photo, description, review and result.
- Show field-level validation beside the problem.
- Explain permission denial and provide a path to retry or use a manual pin.
- Keep a visible location preview.
- Show photo preview and replacement control.
- Disable repeated submission while a request is processing.
- Clearly distinguish `Pending Sync` from `Pending Verification`.
- Preserve the reporter's completed draft if the network fails.
- Use plain-language messages and accessible touch targets.

## Revised UML requirements

### Use-case diagram

- Keep Citizen and Community Volunteer associations.
- Keep `Capture GPS Location` as an included use case.
- Keep `Queue for Offline Sync` as conditional extension behavior.
- Do not merge submission with verification.

### Class diagram

- Add `clientReportId`, `outsideAssignedArea` and `requiresExtraReview` to `HazardReport`.
- Add `source` to `Location`.
- Show the mobile offline record/repository as a technical design element, not as a central report status entity.
- Keep one reporter to many reports.
- Keep one report associated with one required location and one required photo.

### Sequence diagram

Show validation before creation, GPS/manual-pin alternatives, citizen/volunteer area checking, online/offline alternatives, per-report synchronization, acknowledgement-before-delete and stable idempotency on retry.

## Unit-test plan

### Positive cases

1. Valid online citizen report becomes server `PENDING`.
2. Valid online volunteer report becomes `PENDING`.
3. Valid GPS location is stored with source `GPS`.
4. Confirmed manual pin is stored with source `MANUAL`.
5. Valid offline report is persisted as Pending Sync.
6. Queued report becomes Pending Verification after acknowledgement.
7. Outside-area volunteer report is accepted and flagged.

### Negative cases

8. Missing photo is blocked.
9. Missing hazard type is blocked.
10. Missing location is blocked.
11. Description shorter than 10 characters is blocked.
12. Description over 500 characters is blocked.
13. Invalid coordinates are blocked.
14. Unsupported actor cannot submit.

### Edge cases

15. Description exactly 10 characters succeeds.
16. Description exactly 500 characters succeeds.
17. Volunteer location on the assigned-area boundary follows the frozen boundary rule.
18. Multiple queued reports synchronize independently.
19. App restarts while reports are queued and data remains available.
20. Submit button is tapped repeatedly.

### Error and reliability cases

21. GPS fails and manual pin succeeds.
22. Local photo persistence fails and submission is blocked.
23. Network fails before sending and payload is queued.
24. Network fails during sync and the local record remains.
25. Server commits but acknowledgement is lost; retry returns the same report.
26. Repeated `clientReportId` does not create a duplicate.
27. One queued record fails while later records remain intact.

Target more than 80 percent line and branch coverage. Assertions must verify stored data, local queue retention/removal, flags, state labels and duplicate prevention rather than only checking that methods were called.

## Code-quality expectations

- Separate screen components, form state, validation, local repository, sync service and API client.
- Depend on interfaces for GPS, connectivity, photo storage and API access so failures are testable.
- Keep React components free of database and networking rules.
- Use one shared validation schema where practical.
- Avoid duplicating online and offline payload construction.
- Document only decisions that are not clear from the code.

## Required implementation and report evidence

- Mobile report form.
- GPS success and manual-pin fallback.
- Field-level validation.
- Pending Sync state.
- Successful synchronization and Pending Verification state.
- Outside-area flag visible to the officer integration, not as a negative label to the reporter.
- Coverage report exceeding 80 percent.
- Examples of positive, negative, edge and error tests.
- Revised sequence diagram matching the code.

## Definition of done

- All original submission scenarios are implemented or explicitly corrected above.
- No verification decision logic exists in Eshan's module.
- Offline records cannot be lost before acknowledgement.
- Retries cannot create duplicate server reports.
- UI matches the revised mobile storyboard/wireframes.
- All listed tests pass with more than 80 percent coverage.
- Code, UML, screenshots and report explanation describe the same workflow.


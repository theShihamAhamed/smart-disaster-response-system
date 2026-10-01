# Verify Hazard Report Final Component Plan

## Member and assignment scope

**Member:** Javahir N A  
**Registration number:** IT23697546  
**Assigned substantial use case:** Verify Hazard Report  
**Primary actor:** DMC Duty Officer  
**Application:** React web dashboard

Javahir is the sole owner of verification. Eshan supplies `PENDING` reports but does not decide them. Sandaruwan owns the alert after verification creates a draft escalation.

## Rubric target

For the highest individual marks, implement the complete verification workflow and all relevant scenarios; align it exactly with the revised scenario, class and sequence designs; provide excellent UX; use clean, structured, maintainable and documented code with SOLID principles and appropriate patterns; and exceed 80 percent meaningful unit-test coverage across positive, negative, edge and error cases.

## Original Group 050 design to preserve

- A DMC Duty Officer reviews reports in a `PENDING` queue.
- The officer sees the photo, map/GPS location, description and time.
- The officer may mark a genuine report `VERIFIED`.
- The officer may mark a false or mistaken report `REJECTED` with a reason.
- The decision records officer identity and time.
- A verified dangerous report can be escalated to a draft hazard alert.
- Rejected reports notify the reporter.
- The basic dashboard layout of queue, evidence and decision controls is suitable.

## Problems, corrections and justifications

| ID | Problem in the Group 050 design | Final correction | Justification |
| --- | --- | --- | --- |
| VER-01 | Missing or corrupted evidence immediately triggers rejection in the sequence. It does not distinguish genuinely absent evidence from a temporary loading failure. | A technical photo/map loading failure shows Retry and keeps the report `PENDING`. The officer may reject only after reviewing available evidence and entering a reason. | A system outage is not evidence that the citizen submitted a false report. |
| VER-02 | `verifyReport(reportId, decision: ReportStatus): Boolean` uses the broad report-status enum as a decision and returns only true/false. | Use `VerificationResult = VERIFIED | REJECTED` and create a `VerificationDecision` record with officer, reason and time. Return a typed result or conflict. | Improves domain correctness, auditability and error handling. |
| VER-03 | The original class model has no dedicated decision/audit entity. | Add one unique `VerificationDecision` per report. | The scenario explicitly requires an officer/time log and rejection reason. |
| VER-04 | The rejection sequence does not pass or persist the officer's reason consistently. | Require a 10-500 character reason for `REJECTED` and store it in the decision. | Aligns scenario, UI, class model, implementation and tests. |
| VER-05 | Two officers can open and decide the same pending report. | In one transaction, conditionally update only when status is still `PENDING`, create the unique decision and commit. A losing officer receives `REPORT_ALREADY_PROCESSED`. | Prevents conflicting final states and duplicate audit records. |
| VER-06 | A connection can fail after the server commits, making a blind retry ambiguous. | Reuse a decision idempotency key or refresh the report state. If already final, return/display the existing result; otherwise allow a safe retry. | Handles uncertain outcomes without overwriting a final decision. |
| VER-07 | The UI can display Awaiting Verification while also showing a preselected Verified/Tier state. | Start with no decision selected. Enable final confirmation only after the officer explicitly chooses Verify or Reject. | Avoids bias and follows HCI error-prevention principles. |
| VER-08 | Trust score, sensor data and auto-triage appear without a defined model or source and may look authoritative. | Remove the unsupported sensor/auto-triage panel from frozen scope. Show only `requiresExtraReview` as clearly advisory context. | Keeps scope consistent and prevents automation from appearing to make the officer's decision. |
| VER-09 | “Show on the main map” is ambiguous and can bypass official warning control. | A verified report may appear on the internal DMC operational map only. The public warning map displays only Sandaruwan's `ACTIVE` alerts. | Preserves the verification gate and component boundary. |
| VER-10 | Escalation creates an alert without a defined lifecycle and can be duplicated. | Only a `VERIFIED` report may create one linked `DRAFT` alert. Repeated escalation returns the existing draft and never broadcasts it. | Makes verification-to-broadcast integration safe and auditable. |

## Final use-case scenario

### Preconditions

- The actor is an authenticated DMC Duty Officer.
- At least one central report is `PENDING`, although an empty queue is a valid UI state.
- The core report record exists.

### Main verification flow

1. The dashboard lists current `PENDING` reports.
2. The officer opens one report.
3. The system retrieves report ID, status, hazard type, photo, description, location, district, location source, submitted time and extra-review flag.
4. The officer reviews the evidence without a preselected outcome.
5. The officer selects Verify and may enter optional notes.
6. A confirmation dialog summarizes the decision.
7. The API rechecks authorization and `PENDING` state.
8. In one transaction it creates `VerificationDecision`, changes the report to `VERIFIED` and records the time.
9. The report leaves the pending queue and appears on the internal DMC operational map.
10. Escalate to Warning becomes available.

### Rejection flow

1. The officer selects Reject.
2. The UI requires a 10-500 character reason.
3. The officer confirms.
4. The API atomically creates the decision and changes `PENDING -> REJECTED`.
5. The report leaves the queue.
6. A reporter-notification request is created after the decision commits.

### Evidence loading failure

- Show which evidence could not load.
- Keep the report `PENDING`.
- Disable final decision if core evidence required for responsible review is unavailable.
- Offer Retry. Do not silently infer rejection.

### Concurrent or uncertain result

- If another officer commits first, show the final status and disable decision controls.
- If connection is lost after confirmation, refresh/query the current report or retry with the same idempotency key.
- Never create a second decision.

### Escalation flow

1. From a `VERIFIED` report, the officer selects Escalate to Warning.
2. The API creates or returns the unique linked `DRAFT` alert.
3. Open or hand off that draft to Sandaruwan's broadcast workflow.
4. No notification is sent and no public map warning appears at this step.

## Final business rules

- Only an authorized DMC Duty Officer may decide a report.
- Only `PENDING` may transition to `VERIFIED` or `REJECTED`.
- A report receives at most one final `VerificationDecision`.
- `REJECTED` requires a 10-500 character reason.
- Notes for `VERIFIED` are optional.
- Every final decision stores report, officer, result and decision time.
- The report change and decision record commit atomically.
- Technical evidence-loading failure is not an automatic rejection.
- Advisory flags do not make the decision automatically.
- A second officer may not overwrite a final state.
- Only `VERIFIED` may be escalated.
- One source report may have at most one initial alert draft.
- Escalation creates `DRAFT`; it never broadcasts.
- Only `ACTIVE` alerts, not verified reports, appear on the public warning map.

## States and transitions

```text
PENDING -> VERIFIED
PENDING -> REJECTED
```

Invalid:

```text
VERIFIED -> REJECTED
REJECTED -> VERIFIED
VERIFIED -> PENDING
REJECTED -> PENDING
PENDING -> public broadcast
```

Evidence failure, connection loss and notification failure are technical conditions, not report states.

## Required domain objects

- `HazardReport`: submitted evidence and current state; owned jointly as a shared aggregate but decision behavior belongs here.
- `VerificationDecision`: unique report link, officer, `VERIFIED` or `REJECTED`, optional/required reason and timestamp.
- `DmcOfficer`: identity and verification authorization.
- `Alert`: created only as linked `DRAFT` during escalation; lifecycle owned by Sandaruwan.
- `requiresExtraReview`: advisory report flag produced by Eshan's submission flow.

## Required application operations

- `listPendingReports()` returns the current queue and empty state.
- `getReportForReview(reportId)` returns the complete frozen review dataset.
- `decideReport(reportId, result, reason?, idempotencyKey)` atomically decides a pending report.
- `getCurrentDecision(reportId)` resolves an uncertain network result.
- `escalateVerifiedReport(reportId, idempotencyKey)` creates or returns one draft alert.
- `notifyReporterOfRejection()` runs only after the rejection commits; notification failure must not roll back the decision.

## UI flow and HCI requirements

- Pending queue supports clear selection and an empty state.
- Evidence view groups report details, photo, map/location and advisory flag.
- Begin with no Verify/Reject option selected.
- Keep Verify and Reject visually distinct without preselecting either.
- Require reason only when rejecting and show an inline error.
- Use a final confirmation dialog containing report ID and chosen result.
- Disable Escalate while pending or rejected.
- On evidence error, show Retry and keep the state unchanged.
- On a concurrency conflict, show `Already processed`, refresh the final state and disable controls.
- Label the map destination `Internal DMC operational map`.

## Revised UML requirements

### Use-case diagram

- Keep DMC Duty Officer -> Verify Hazard Report.
- Keep `Escalate to Official Warning` as conditional extension behavior with condition `[report.status = VERIFIED]`.

### Class diagram

- Add `VerificationDecision` and `VerificationResult`.
- Replace the Boolean verification method with a decision operation that accepts a proper result and optional reason.
- Show `HazardReport 1 -> 0..1 VerificationDecision`.
- Add the alert lifecycle ability to represent `DRAFT` and source-report linkage.

### Sequence diagram

Show full evidence retrieval, evidence-error retry without state change, verify/reject alternatives, rejection reason, idempotency/state recheck, atomic decision and status save, already-processed conflict, uncertain-result refresh, and verified-only draft escalation.

## Unit-test plan

### Positive cases

1. List pending reports.
2. Return an empty queue normally.
3. Load the complete core review dataset.
4. Verify a pending report.
5. Reject a pending report with a valid reason.
6. Store officer ID and decision time.
7. Create one draft alert from a verified report.
8. Return the existing draft for repeated escalation.

### Negative cases

9. Unauthorized user cannot decide a report.
10. Reject without a reason is blocked.
11. Too-short or too-long rejection reason is blocked.
12. Verify an already verified report is rejected.
13. Reject an already rejected report is rejected.
14. Reverse a final decision is rejected.
15. Escalate a pending report is rejected.
16. Escalate a rejected report is rejected.
17. Nonexistent report returns not found.

### Edge cases

18. Reason exactly 10 characters succeeds.
19. Reason exactly 500 characters succeeds.
20. Optional verified notes are empty.
21. Extra-review flag is visible but does not force an outcome.
22. Queue changes while the officer has a report open.

### Error and concurrency cases

23. Photo cannot load and report remains pending.
24. Map cannot load and report remains pending.
25. Database failure rolls back decision and status.
26. Two officers decide the same report; only one commits.
27. Connection fails before commit; safe retry remains possible.
28. Connection fails after commit; refresh returns existing result.
29. Duplicate decision idempotency key returns existing result.
30. Draft creation fails without changing the verified report.
31. Reporter-notification failure does not undo rejection.

Target more than 80 percent line and branch coverage with meaningful assertions over final state, audit data, rollback and conflicts.

## Code-quality expectations

- Separate controller, application service, domain rules and repository interfaces.
- Use a transaction boundary around the decision and report transition.
- Centralize state-transition validation.
- Use typed errors instead of Boolean success values.
- Keep notification and alert-draft creation behind interfaces.
- Do not place business logic in React components or route handlers.
- Avoid a generic “update status” operation that can bypass rules.

## Required implementation and report evidence

- Pending queue and complete evidence view.
- Neutral initial decision state.
- Verified flow.
- Rejected flow with reason.
- Evidence-loading error and Retry.
- Already-processed conflict.
- Verified-only escalation producing a draft.
- Coverage report above 80 percent and representative test output.
- Revised sequence and class diagrams matching implementation.

## Definition of done

- All verification scenarios and corrections above are implemented.
- Evidence failures cannot auto-reject.
- A report can receive only one final decision.
- Escalation cannot bypass `VERIFIED` and cannot broadcast.
- UI matches revised storyboard/wireframes.
- All tests pass with more than 80 percent coverage.
- UML, code, screenshots and report use the same states and rules.


# Broadcast Hazard Alert Final Component Plan

## Member and assignment scope

**Member:** Sandaruwan M P U  
**Registration number:** IT23860964  
**Assigned substantial use case:** Broadcast Hazard Alert  
**Primary actor:** DMC Duty Officer with broadcast permission  
**Application:** React web dashboard

Sandaruwan owns alert drafts, target selection, preview, duplicate checks, activation, delivery tracking, push retry, SMS fallback, versioned updates, cancellation and broadcast audit. Javahir owns the verified source report and initial escalation eligibility.

## Rubric target

For the highest individual marks, implement all main, alternate and failure scenarios end to end; keep implementation aligned with the revised use case, UML and wireframes; provide excellent UX; write clean, structured and maintainable code with SOLID principles and appropriate patterns; and exceed 80 percent meaningful unit-test coverage including positive, negative, edge and error cases.

## Original Group 050 design to preserve

- A DMC Duty Officer with permission broadcasts an official alert.
- The alert starts from a verified report or saved draft.
- The officer selects hazard type, severity and affected target area.
- The officer enters a message and safety instructions.
- The system provides a preview and recipient estimate.
- Sending requires a second confirmation.
- Draft saving remains available.
- An active alert can be updated or cancelled.
- Cancellation includes a reason and an All Clear message.
- Duplicate alerts produce a warning.
- Push Notification Service and SMS Gateway remain external systems.
- The active warning appears on the public hazard map.
- Broadcast actions are audited.

## Problems, corrections and justifications

| ID | Problem in the Group 050 design | Final correction | Justification |
| --- | --- | --- | --- |
| BHA-01 | The scenario says push and SMS go to everyone, while the use-case diagram and sequence show SMS as conditional fallback. | Use push as the primary channel. After two push attempts total fail, queue one SMS fallback attempt. | Matches `Trigger SMS Fallback <<extend>>`, avoids unnecessary duplicate messages and resolves the artifact inconsistency. |
| BHA-02 | Alert lifecycle and per-recipient delivery success are treated as the same state. | Use `AlertStatus` separately from `DeliveryStatus`. The alert becomes `ACTIVE` when the activation transaction commits and delivery work is accepted. | An official warning can be active even if some recipients have delivery failures. |
| BHA-03 | The original `Alert` class lacks source report, creator, safety instructions, lifecycle, version and cancellation data. | Extend `Alert` and add target links, `NotificationDelivery` and `BroadcastAudit`. | Required by draft, update, cancel, retry and audit scenarios already present in the original design. |
| BHA-04 | “Same hazard and area” duplicate detection is too vague. | Similar means an existing `ACTIVE` alert with the same hazard type and at least one shared target zone. | Deterministic and testable without advanced GIS. |
| BHA-05 | Retry or repeated clicks can create duplicate alerts or deliveries. | Require idempotency keys, reuse the same alert identity for retry and disable repeated send while processing. | Prevents duplicate emergency warnings. |
| BHA-06 | Updating an active alert can supersede it before the replacement is safely active. | Create a replacement draft/version. Activate it first in one transaction, then mark the prior version `SUPERSEDED`. On failure the old alert stays active. | Preserves the valid warning if an update fails. |
| BHA-07 | Cancellation behavior and public-map removal are not fully modeled. | Only `ACTIVE` can become `CANCELLED`; require a reason, remove it from active-map queries, create All Clear delivery records and audit the action. | Aligns lifecycle, UI, map and notification behavior. |
| BHA-08 | The wireframe contains a safety-instruction minimum length not approved by the written scenario. | Require meaningful non-blank safety instructions with a maximum of 1000 characters; do not invent a special minimum. | Keeps implementation tied to approved requirements. |
| BHA-09 | The original sequence omits duplicate, update, cancel and complete retry/failure flows. | Add those branches or separate supporting sequence diagrams and show alert and delivery state changes independently. | The rubric requires clear alignment with all relevant scenarios. |
| BHA-10 | The postcondition claims all citizens received the alert immediately. | Report delivery counts and failures separately; do not claim 100 percent delivery unless records prove it. | Provides accurate feedback and avoids a false success state. |

## Final use-case scenario

### Preconditions

- The actor is an authenticated DMC Duty Officer with broadcast permission.
- A source report is `VERIFIED`, or an existing alert is `DRAFT`.
- Target-zone data is available.
- Notification adapters may be mocked but must expose success/failure behavior.

### Main broadcast flow

1. The officer opens a draft created from a verified report or starts from that report.
2. The form is prefilled with source hazard type and location where available.
3. The officer selects `ADVISORY`, `WARNING` or `EVACUATION` severity.
4. The officer selects one or more target zones.
5. The officer enters a non-blank message and safety instructions.
6. The system validates the draft and displays a preview with estimated recipients.
7. The system checks for a similar active alert.
8. If no conflict exists, the officer selects Confirm and Send.
9. A second confirmation summarizes the irreversible public action.
10. In one transaction the API rechecks `DRAFT`, validates content, changes it to `ACTIVE`, creates initial delivery records and writes a broadcast audit.
11. Push delivery begins. Failures receive the frozen retry and fallback policy.
12. The public map includes the active target zones.
13. The UI shows alert state separately from delivery counts and failures.

### Save draft flow

- Save valid partial/completed content as `DRAFT`.
- Do not create public map data or notification deliveries.
- The draft can be reopened and edited.

### Similar active alert flow

- Before activation, find same hazard type plus any shared target zone among `ACTIVE` alerts.
- Show the existing alert and block direct duplicate activation.
- Allow the officer to open/update the existing alert or discard the new draft.

### Update active alert flow

1. Open an `ACTIVE` alert and select Update.
2. Create a replacement draft with `parentAlertId` and incremented version.
3. Edit, preview, check duplicates and confirm it.
4. Atomically activate the replacement and mark the old alert `SUPERSEDED`.
5. If activation fails, the old alert remains `ACTIVE` and the replacement remains `DRAFT`.

### Cancel active alert flow

1. Select Cancel on an `ACTIVE` alert.
2. Enter a required 10-500 character reason.
3. Confirm.
4. Change the alert to `CANCELLED`, remove it from active-map results, create All Clear delivery records and audit the action.
5. Gateway failure is recorded but does not reactivate the alert.

### Delivery failure flow

- Attempt push at most twice in total.
- If push remains failed, queue one SMS fallback attempt.
- If SMS succeeds, mark `SMS_SENT`.
- If SMS fails, mark `FAILED_FINAL` and show the officer that operational backup channels such as radio/TV may be needed.
- Never create a new alert for a delivery retry.

## Final business rules

- Only an officer with broadcast permission may create, activate, update or cancel alerts.
- A normal initial alert must reference a `VERIFIED` report.
- One verified report may create at most one initial draft.
- A draft requires hazard type, severity, at least one target zone, message and safety instructions before activation.
- Saving a draft never sends notifications.
- Similar-active-alert check is mandatory before activation.
- Only `DRAFT` may become `ACTIVE`.
- `ACTIVE` means activation committed and delivery processing started, not universal receipt.
- Push is primary; SMS is fallback only.
- Alert state and delivery state are separate.
- A replacement supersedes the old alert only after the replacement activates.
- Only `ACTIVE` may be cancelled.
- Cancellation requires a reason and creates All Clear delivery work.
- Repeated commands are idempotent.
- Delivery failure never returns an alert to draft.
- Every create, activate, supersede, cancel and major failure action is auditable.

## States and transitions

Alert:

```text
DRAFT -> ACTIVE
ACTIVE -> SUPERSEDED
ACTIVE -> CANCELLED
```

Discarding an unused draft is deletion, not `DRAFT -> CANCELLED`.

Delivery:

```text
PENDING -> PUSH_SENT
PENDING -> PUSH_FAILED
PUSH_FAILED -> SMS_FALLBACK_QUEUED
SMS_FALLBACK_QUEUED -> SMS_SENT
SMS_FALLBACK_QUEUED -> FAILED_FINAL
```

## Required domain objects

- `Alert`: source report, creator, hazard type, severity, message, safety instructions, status, version, parent version and issue/cancel data.
- `AlertTargetZone`: many-to-many target-zone link.
- `NotificationDelivery`: alert, recipient/reference, status, attempt number, failure reason and timestamps.
- `BroadcastAudit`: alert, officer, action, reason and time.
- `HazardReport`: read-only verified source from Javahir's module.
- `TargetZone`: shared geographic/district object.
- Push and SMS adapters: external service interfaces suitable for mocks.

## Required application operations

- `createAlertFromVerifiedReport()` creates/returns the unique draft.
- `saveDraft()` validates editable fields without sending.
- `previewAlert()` returns formatted preview and estimated recipients.
- `findSimilarActiveAlerts()` applies the frozen duplicate rule.
- `broadcastAlert()` performs idempotent activation and creates delivery work.
- `processDeliveries()` follows the frozen retry/fallback policy.
- `createReplacementDraft()` starts an update version.
- `activateReplacement()` activates new and supersedes old atomically.
- `cancelAlert()` cancels active, creates All Clear and audit data.
- `retryEligibleDeliveries()` retries only eligible records for the same alert.

## UI flow and HCI requirements

- Preserve the original dashboard/composer structure.
- Clearly label Hazard Type, Severity, Affected Area, Alert Message and Safety Instructions.
- Keep recipient estimate visible before confirmation and label it as an estimate.
- Show Preview before Confirm and Send.
- Use a second confirmation for activation.
- Distinguish Draft, Active, Superseded and Cancelled visually.
- Show delivery progress/counts separately from alert state.
- Show validation beside the affected field.
- Disable repeated send while processing.
- Show the similar active alert with an action to open it.
- Cancellation requires reason entry and confirmation.
- Failure feedback must state whether push, retry, SMS or all channels failed.

## Revised UML requirements

### Use-case diagram

- Keep DMC Duty Officer, Push Notification Service and SMS Gateway.
- Keep `Determine Target Zone <<include>>`.
- Keep `Trigger SMS Fallback <<extend>>` with condition `[push attempts failed]`.
- Do not add login/logout as assessed use cases.

### Class diagram

- Extend `Alert` with lifecycle, source, creator, version and safety data.
- Add `AlertTargetZone`, `NotificationDelivery` and `BroadcastAudit`.
- Show one alert to one-or-more target zones and zero-or-more delivery/audit records.
- Keep push and SMS as service interfaces, not domain entities.

### Sequence diagram

Show verified source/draft load, validation, preview, duplicate check, save/confirm alternatives, activation transaction, audit, separate delivery states, push retry, SMS fallback, replacement activation/supersede order, cancellation and All Clear.

## Unit-test plan

### Positive cases

1. Create a draft from a verified report.
2. Return existing draft for repeated source request.
3. Save a valid draft without delivery.
4. Preview and estimate recipients.
5. Activate a valid draft.
6. Push succeeds.
7. Push failure followed by retry succeeds.
8. Push attempts fail and SMS succeeds.
9. Replacement activates and old alert becomes superseded.
10. Cancel active alert and create All Clear.
11. Broadcast and cancellation audits are created.

### Negative cases

12. Non-verified source cannot create initial draft.
13. Unauthorized officer cannot broadcast.
14. Missing target zone blocks activation.
15. Blank message blocks activation.
16. Blank safety instructions block activation.
17. Similar active alert blocks duplicate activation.
18. Cancel draft is rejected as a lifecycle operation.
19. Update a draft through active-update operation is rejected.
20. Cancel superseded or cancelled alert is rejected.

### Edge cases

21. Zero estimated recipients is shown but requires explicit officer confirmation/policy handling.
22. One recipient succeeds.
23. Large recipient set produces records without changing lifecycle semantics.
24. Multiple target zones with one shared zone trigger similarity.
25. Same hazard with no shared zone is not considered similar.
26. Replacement immediately after activation remains version-consistent.

### Error, retry and concurrency cases

27. Connection fails before activation and alert remains draft.
28. Connection result is uncertain; idempotent retry returns same active alert.
29. Push gateway is unavailable.
30. SMS gateway is unavailable and delivery becomes final failure.
31. Repeated delivery retry creates no second alert.
32. Two officers activate the same draft; only one succeeds.
33. Two officers update the same active version; one receives a conflict.
34. Activation database failure leaves no partial active/delivery state.
35. Audit creation failure rolls back activation transaction.
36. Failed replacement leaves old alert active.
37. All Clear delivery failure does not reactivate cancelled alert.

Target more than 80 percent line and branch coverage with assertions over lifecycle, delivery states, versions, idempotency and rollback.

## Code-quality expectations

- Model alert lifecycle in one domain service/entity, not scattered conditions.
- Use a delivery strategy/orchestrator behind push and SMS interfaces.
- Keep repositories and external gateways behind interfaces.
- Use typed state/conflict errors.
- Keep activation and replacement transaction boundaries explicit.
- Do not perform gateway calls inside React components.
- Avoid copying entire update logic; share validation and activation behavior.

## Required implementation and report evidence

- Draft composer and save flow.
- Preview and estimated recipient count.
- Similar-active-alert warning.
- Final confirmation and Active state.
- Delivery status showing push success and SMS fallback.
- Versioned update and prior Superseded state.
- Cancellation reason, Cancelled state and All Clear.
- Failure status with operational backup advice.
- Coverage above 80 percent and representative test output.
- Revised class and sequence diagrams matching the code.

## Definition of done

- All original alert scenarios and corrections above are implemented.
- Push and SMS behavior is no longer contradictory.
- Alert and delivery states remain separate.
- Updates cannot remove the old active alert before replacement succeeds.
- Retries cannot create duplicate alerts.
- UI matches revised storyboard/wireframes.
- All tests pass with more than 80 percent coverage.
- UML, code, screenshots and report describe identical behavior.


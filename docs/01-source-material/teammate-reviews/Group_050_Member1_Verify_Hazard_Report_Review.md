# Component Final Review — Verify Hazard Report

## Member
Name: **[YOUR NAME]**  
Registration No: **[YOUR REGISTRATION NUMBER]**  
Assigned Use Case: **Verify Hazard Report**  
Original Component Owner: **A.P.P Lanka — IT23714298**  
Primary Actor: **DMC Duty Officer**

## Sources Reviewed
This review was checked against:

1. Case Study 2 requirement document.
2. SE3070 Assignment 02 specification and marking rubric.
3. Group_050 Assignment 01 — Verify Hazard Report written scenario.
4. Full high-level use case diagram.
5. Full class diagram.
6. Detailed Verify Hazard Report sequence diagram.
7. Verify Hazard Report storyboard.
8. Low-fidelity wireframe.
9. High-fidelity wireframe.
10. Current team baseline decisions.

---

## Review Confidence and Manual Confirmation

I rechecked this review against the written scenario, use case diagram, class diagram, sequence diagram, storyboard, low-fidelity UI, high-fidelity UI, Case Study 2 requirements, and Assignment 02 specification.

### Confirmed findings
These are directly visible in the supplied artifacts:
- VER-01 — evidence-error branch can lead directly to rejection.
- VER-02 — rejection reason/audit data is not fully represented in the sequence/class design.
- VER-03 — high-fidelity UI shows `AWAITING VERIFICATION` while also showing `VERIFIED • TIER 1`, and escalation appears active.
- VER-05 — low-fidelity UI introduces a required 20-character assessment note that is not stated in the written scenario.
- VER-06 — the sequence diagram retrieves less review data than the UI displays.
- VER-09 — the scenario says escalation creates a draft alert, but the Alert class does not clearly model a `DRAFT` lifecycle state.

### Valid engineering improvements / ambiguities
These are not explicit errors in the case-study text, but they are important gaps to clarify before implementation:
- VER-07 — two officers processing the same pending report.
- VER-08 — uncertain retry after connection loss.
- VER-10 — meaning of “main map”.

### Team clarification recommended
- VER-04 — the high-fidelity UI shows “Automated Dispatches” and operational actions while the report is still awaiting verification. Confirm whether these are only recommendations/context or actions that really execute. If they are only advisory, label them clearly and do not treat them as a case-study violation.

## 1. Original Design Summary

The component allows a DMC Duty Officer to review a citizen/volunteer hazard report before that report can influence an official warning.

### Original main flow
1. The officer views reports with status `PENDING`.
2. The officer opens one report.
3. The system displays the photo, map/GPS location, description and time.
4. The officer reviews the evidence.
5. If the report is genuine, the officer selects **Verify**.
6. Status changes from `PENDING` to `VERIFIED`.
7. The officer ID and verification time are logged.
8. The report leaves the pending queue.
9. A serious verified report may later be escalated to the warning workflow.

### Original alternate flows
- **Reject:** officer rejects a fake/mistaken report and enters a reason.
- **Escalate:** a serious verified report creates a draft hazard alert for the warning workflow.

### Original exception flows
- missing/corrupted photo or bad GPS;
- connection lost while submitting the verification decision.

### Overall assessment
The use case itself is **appropriate and substantial**. It directly matches the Case Study 2 requirement that citizen reports must be reviewed and verified by a duty officer before they influence an official warning. The use case should be preserved, with focused corrections rather than a redesign.

---

## 2. Findings

### Finding VER-01 — Temporary evidence-loading failure is treated as an automatic rejection

**Original design:**  
The sequence diagram branch `[Missing or corrupted evidence]` immediately performs `verifyReport(..., REJECTED)`. The written scenario also says a photo/GPS problem leads to rejection.

**Problem:**  
The design mixes two different situations:

1. the submitted evidence is genuinely missing/invalid; and
2. the evidence exists, but the dashboard temporarily cannot load it.

A temporary loading failure does not prove that the report is false. The written precondition also says the report already has a photo, GPS location and description.

**Category:**  
Requirement/design inconsistency; domain-logic issue; reliability issue.

**Impact:**  
A genuine emergency report could be rejected because of a technical failure.

**Proposed correction:**  
- Required photo/GPS should normally be validated by the submission component before the report reaches the DMC queue.
- If the evidence exists but cannot currently be loaded, keep the report `PENDING`.
- Show **Evidence unavailable — Retry**.
- The officer may reject only through an explicit human decision, with a reason such as `Insufficient/invalid evidence`.

**Justification:**  
A technical failure and a business rejection are not the same thing. Human verification must remain the final decision.

**Artifacts affected:**
- [x] Use case scenario
- [ ] Use case diagram
- [ ] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-02 — Rejection reason and decision audit are not fully represented in the UML

**Original design:**  
The written scenario requires a rejection reason and says the system logs the officer ID and decision time. However:

- the rejection sequence calls `verifyReport("R-101", REJECTED)` without a reason;
- no decision/audit object is created;
- the class method uses `decision: ReportStatus`.

**Problem:**  
The scenario, sequence diagram and class diagram do not represent the same information. Also, `ReportStatus` contains `QUEUED_OFFLINE` and `PENDING`, which are not valid verification decisions.

**Category:**  
UML consistency issue; missing data; auditability issue.

**Impact:**  
The implementation may lose the rejection reason or fail to clearly record who made the final decision and when.

**Proposed correction:**  
Add:

```text
VerificationResult
- VERIFIED
- REJECTED
```

and:

```text
VerificationDecision
- decisionId
- reportId
- officerId
- result
- reason
- decidedAt
```

`reason` is required for `REJECTED`.

Update the verification operation so it uses `VerificationResult`, not the full `ReportStatus` enum.

**Justification:**  
This directly implements information already required by the original written scenario.

**Artifacts affected:**
- [ ] Use case scenario
- [ ] Use case diagram
- [x] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-03 — High-fidelity UI shows conflicting verification states

**Original design:**  
The storyboard shows the correct order:

`Review -> Verify -> VERIFIED -> Escalate`

The low-fidelity wireframe also shows:
- status `EVALUATING`;
- Verify and Reject available;
- **Escalate to Warning disabled**.

However, the high-fidelity wireframe simultaneously shows:
- `AWAITING VERIFICATION`;
- selected assessment status `VERIFIED • TIER 1`;
- an active **VERIFY REPORT** button;
- an active **ESCALATE TO WARNING** button.

**Problem:**  
The UI behaves as if the report is already verified before the officer has completed the verification action.

**Category:**  
UI/HCI issue; state inconsistency; cross-artifact inconsistency.

**Impact:**  
The officer can be confused or biased, and escalation may appear available before verification.

**Proposed correction:**  

For `PENDING`:

```text
Decision: No decision yet
Verify: enabled
Reject: enabled
Escalate: disabled
```

After successful verification:

```text
Status: VERIFIED
Verify: disabled
Reject: disabled
Escalate: enabled
```

**Justification:**  
This matches the storyboard, low-fidelity design, use case logic and Case Study requirement.

**Artifacts affected:**
- [ ] Use case scenario
- [ ] Use case diagram
- [ ] Class diagram
- [ ] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-04 — High-fidelity UI implies operational actions before verification

**Original design:**  
While the report is still shown as `AWAITING VERIFICATION`, the high-fidelity UI displays:
- `AUTOMATED DISPATCHES`;
- an early-warning SMS broadcast item;
- rescue/operational actions;
- notes stating immediate rescue deployment was dispatched.

**Problem:**  
The Case Study explicitly says unverified citizen reports must be reviewed and verified before they influence an official warning level. Operational action based directly on an unverified report is therefore unsafe and unclear.

**Category:**  
Requirement inconsistency; HCI issue; integration issue.

**Impact:**  
An unverified report could appear to trigger warning/response actions prematurely.

**Proposed correction:**  
- Keep sensor/triage information only as **advisory context**.
- Do not automatically broadcast an official warning from a `PENDING` report.
- Do not represent response dispatch as already completed because of the pending citizen report.
- Warning escalation becomes available only after `VERIFIED`.
- If the team wants automated recommendations, label them **Recommendation only — not executed**.

**Justification:**  
This protects the required human verification gate.

**Artifacts affected:**
- [x] Use case scenario
- [ ] Use case diagram
- [ ] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

> **Manual check:** Confirm whether the “Automated Dispatches” area represents actions already executed or only recommendations. If it is only advisory, change the wording/visual state rather than redesigning the use case.

---

### Finding VER-05 — Low-fidelity UI makes officer notes mandatory without a matching business rule

**Original design:**  
The low-fidelity wireframe shows:

`ASSESSMENT & DIRECTIVES LOG — REQUIRED`

with a minimum of 20 characters.

The written scenario requires a reason when a report is rejected, but does not require a 20-character note for a normal verification.

**Problem:**  
The UI introduces a mandatory rule that is not defined in the use case scenario.

**Category:**  
UI/requirement inconsistency; usability issue.

**Impact:**  
A valid verification could be blocked only because the officer did not write an arbitrary minimum number of characters.

**Proposed correction:**  
- Normal officer notes may be optional for `VERIFIED`.
- Rejection reason is mandatory for `REJECTED`.
- If the team wants mandatory notes for every decision, that rule must first be added explicitly to the scenario and business rules.

**Justification:**  
The UI should not silently create a new business requirement.

**Artifacts affected:**
- [ ] Use case scenario
- [ ] Use case diagram
- [ ] Class diagram
- [ ] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-06 — Sequence diagram does not retrieve all information shown in the review UI

**Original design:**  
The sequence retrieves mainly:
- status;
- photo URL;
- description;
- location;
- district/river basin.

The UI additionally shows:
- hazard type/classification;
- timestamp/age;
- citizen contact;
- trust score;
- severity;
- verification checklist;
- sensor/river-gauge data;
- auto-triage information.

The class diagram contains some core values such as timestamp and hazard type, but the verification sequence does not retrieve all of them. Trust score and sensor/auto-triage data are also not clearly represented in the class diagram.

**Problem:**  
The use case scenario, sequence diagram, class diagram and UI do not describe the same review dataset.

**Category:**  
UML consistency issue; implementation risk.

**Impact:**  
A developer following the sequence diagram exactly would not have all information required by the supplied screen.

**Proposed correction:**  
Define the minimum final review dataset:

```text
reportId
status
hazardType
photo/evidence
description
GPS/location
district
submittedAt
reporter reference/contact where permitted
```

Then either:
- retrieve these explicitly in the sequence; or
- use a conceptual operation such as `getReportForReview(reportId)`.

If trust/sensor/auto-triage information remains, define its source and mark it advisory. Assignment 02 allows IoT/ML behavior to be mocked/simulated.

**Justification:**  
The UI, UML and implementation must stay consistent.

**Artifacts affected:**
- [ ] Use case scenario
- [ ] Use case diagram
- [x] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-07 — Final decision does not explicitly protect against two officers processing the same report

**Original design:**  
The dashboard shows a shared pending-report queue, but the scenario/sequence does not define what happens if two officers open the same report at the same time.

**Problem:**  
Officer A could verify while Officer B rejects the same `PENDING` report.

**Category:**  
Reliability issue; concurrency issue; state-transition issue.

**Impact:**  
Conflicting decisions or duplicate audit records.

**Proposed correction:**  
Use a simple atomic rule:

1. Check that the report is still `PENDING`.
2. Save `VerificationDecision`.
3. Change report status to `VERIFIED` or `REJECTED`.
4. Commit together.

If another officer already processed it, return:

`Report already processed — refresh latest status.`

Do not build a complex locking system.

**Justification:**  
This is a small, realistic correction for a multi-officer dashboard.

**Artifacts affected:**
- [x] Use case scenario
- [ ] Use case diagram
- [x] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-08 — Connection-loss retry is underdefined

**Original design:**  
The exception flow says the officer retries after connection returns. The sequence simply returns `false` for a connection-lost verification attempt.

**Problem:**  
The response can be lost after the server has already stored the decision. Blindly clicking Verify again can create confusing results or duplicate log records.

**Category:**  
Reliability issue; retry/idempotency issue.

**Impact:**  
The officer may not know whether the decision was saved.

**Proposed correction:**  
Keep the solution simple:
- one final `VerificationDecision` per report;
- every decision operation first checks whether the report is still `PENDING`;
- after a connection problem, refresh the current report status;
- if it is already final, display the existing result;
- if still `PENDING`, allow a retry.

An optional request/idempotency ID may be used, but a complex retry framework is unnecessary.

**Justification:**  
The original design already includes connection failure, and the case study expects graceful handling of unreliable connectivity.

**Artifacts affected:**
- [x] Use case scenario
- [ ] Use case diagram
- [x] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-09 — Escalation creates an Alert, but the required DRAFT state is not modeled

**Original design:**  
The written scenario says:

`Escalate to Warning -> system creates a draft Hazard Alert.`

The sequence creates `Alert(severity, hazardType, targetZone)`.

However, the class diagram's `Alert` class does not contain an alert lifecycle/status field that can represent `DRAFT`.

**Problem:**  
The scenario cannot be represented accurately by the current class model.

**Category:**  
Class-diagram issue; cross-component integration issue.

**Impact:**  
The implementation may accidentally treat a newly escalated alert as already issued/active.

**Proposed correction:**  
Coordinate with the Broadcast Hazard Alert owner and add an alert lifecycle capable of representing at least `DRAFT`.

The team's current baseline already proposes:

```text
DRAFT
ACTIVE
SUPERSEDED
CANCELLED
```

The escalation operation should create a `DRAFT` alert linked to the verified source report. It must not broadcast the alert automatically.

**Justification:**  
Verification and broadcast are separate components. Escalation prepares the warning; Broadcast Hazard Alert controls sending it.

**Artifacts affected:**
- [x] Use case scenario
- [x] Use case diagram
- [x] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

### Finding VER-10 — "Main map" is ambiguous

**Original design:**  
The main flow says a verified report is shown on the "main map".

**Problem:**  
It is unclear whether this means:
- the internal DMC operational map; or
- the public citizen hazard/warning map.

A verified ground report is not automatically the same as an official public warning.

**Category:**  
Requirement ambiguity; integration issue.

**Impact:**  
Verification could accidentally bypass the official warning workflow.

**Proposed correction:**  
Clarify that verification may place the report on the **internal DMC operational map**. Public warning publication happens only through the Broadcast Hazard Alert component.

**Justification:**  
This preserves the Case Study rule that official warning influence occurs only after verification and through the warning process.

**Artifacts affected:**
- [x] Use case scenario
- [ ] Use case diagram
- [ ] Class diagram
- [x] Sequence diagram
- [x] UI/wireframe
- [x] Implementation
- [x] Tests

---

## 3. What Should Remain Unchanged

The following original design decisions are good and should remain:

1. `Verify Hazard Report` remains a substantial use case.
2. DMC Duty Officer remains the primary actor.
3. Reports enter the verification queue as `PENDING`.
4. The officer reviews photo and location evidence.
5. The officer can verify or reject.
6. Final report states remain `VERIFIED` and `REJECTED`.
7. Rejection requires a reason.
8. The decision should record the officer and time.
9. A verified serious report may be escalated.
10. Escalation remains connected to the Broadcast Hazard Alert workflow.
11. The storyboard's basic order — review, verify, then escalate — should remain.
12. The low-fidelity layout of pending list + report evidence + decision panel is suitable.
13. Sensor/auto-triage context may remain if clearly advisory and mocked where necessary.
14. The high-level use case relationship between DMC Duty Officer and Verify Hazard Report is correct.

---

## 4. Final Proposed Business Rules

- **BR-VER-01:** Only an authorized DMC Duty Officer may make a verification decision.
- **BR-VER-02:** Only a report with status `PENDING` may be decided.
- **BR-VER-03:** Valid final decisions are only `VERIFIED` and `REJECTED`.
- **BR-VER-04:** A rejected report must contain a rejection reason.
- **BR-VER-05:** Every final decision records report ID, officer ID, result and decision time.
- **BR-VER-06:** A technical evidence-loading failure does not automatically reject a report.
- **BR-VER-07:** A final decision cannot be silently overwritten by another officer.
- **BR-VER-08:** Only a `VERIFIED` report may be escalated to the official warning workflow.
- **BR-VER-09:** Escalation creates/prepares a `DRAFT` alert; it does not broadcast the warning.
- **BR-VER-10:** A verified report may appear on the internal DMC operational map but is not automatically a public warning.
- **BR-VER-11:** Auto-triage, trust and sensor information are advisory only.
- **BR-VER-12:** An unverified citizen report must not automatically trigger official warning broadcast.
- **BR-VER-13:** After a connection problem, the system checks the current report state before accepting a retry.
- **BR-VER-14:** The UI may not show `VERIFIED` as the final state until the verification operation succeeds.

---

## 5. Final Proposed States and Transitions

### States

For the verification component:

```text
PENDING
VERIFIED
REJECTED
```

`QUEUED_OFFLINE` belongs mainly to the submission/synchronization flow before the report reaches the central pending queue.

### Valid transitions

```text
PENDING -> VERIFIED
PENDING -> REJECTED
```

After verification:

```text
VERIFIED -> Escalate to Warning workflow
```

The report itself stays `VERIFIED`. A separate Alert object is created as `DRAFT`.

### Invalid transitions

```text
VERIFIED -> REJECTED
REJECTED -> VERIFIED
VERIFIED -> PENDING
REJECTED -> PENDING
PENDING -> Escalate to Official Warning
```

### Temporary technical conditions

These should not become final report states:

```text
Evidence load failure
Connection failure
Notification failure
Sensor/triage data unavailable
```

---

## 6. Required Domain Objects

### HazardReport
**Purpose:** citizen/volunteer report being reviewed.

Important fields:
```text
reportId
reporterId
hazardType
photo/evidence reference
description
location
submittedAt
status
```

If the trust-score UI is retained:
```text
trustScore / trust flag
```

Important behavior:
- provide report-review data;
- allow only valid final state transitions.

Owned/shared:
- shared with Submit Citizen Hazard Report.

---

### VerificationDecision
**Purpose:** auditable final officer decision.

Important fields:
```text
decisionId
reportId
officerId
result
reason
decidedAt
```

Important behavior:
- enforce reason for rejection;
- one final decision per report.

Owned by:
- Verify Hazard Report component.

---

### VerificationResult
```text
VERIFIED
REJECTED
```

---

### DMCOfficer
**Purpose:** authorized human reviewer.

Important behavior:
- review report;
- make final decision;
- escalate verified report.

---

### Alert
**Purpose:** warning draft created by escalation.

Important additions/clarifications:
```text
status
sourceReportId / existing source-report relationship
```

At minimum, status must support:
```text
DRAFT
```

Final alert lifecycle must be coordinated with the Broadcast Hazard Alert component.

---

### Optional MonitoringDataService
Use only if the final UI keeps sensor/river-gauge/auto-triage context.

For Assignment 02, this may be mocked/simulated.

---

## 7. Dependencies on Other Components

### Inputs required from Submit Citizen Hazard Report
- report ID;
- reporter reference;
- hazard type;
- required photo/evidence;
- GPS/location;
- description;
- timestamp;
- `PENDING` state;
- trust/outside-area data if that feature remains.

### Outputs provided to Broadcast Hazard Alert
- verified report reference;
- hazard type/location;
- `DRAFT` alert created/prepared during escalation.

### Important integration rules
1. Verify component must not change the original submitted evidence.
2. An unverified report cannot be escalated.
3. Escalation does not directly broadcast.
4. Sensor/triage data must not make the final decision automatically.
5. Final alert status/lifecycle must use the same model as the Broadcast component.

---

## 8. Proposed Application/API Operations

### `listPendingReports()`
Returns the current pending queue.

Validation/errors:
- authorized officer;
- empty queue is a valid result.

### `getReportForReview(reportId)`
Returns the complete review dataset.

Core result:
```text
reportId
status
hazardType
photo/evidence
description
location
district
submittedAt
reporter context where permitted
```

Errors:
- report not found;
- evidence temporarily unavailable.

Evidence-loading error does not automatically reject.

### `decideReport(reportId, result, reason?)`
Expected behavior:
1. confirm report is still `PENDING`;
2. validate rejection reason where required;
3. create `VerificationDecision`;
4. update report status;
5. save atomically;
6. return the final result.

Errors:
- invalid state;
- missing rejection reason;
- already processed by another officer;
- database/connection failure.

### `escalateVerifiedReport(reportId)`
Validation:
- report must be `VERIFIED`.

Result:
- create/prepare `DRAFT` alert linked to the report.

Error:
- report not verified;
- draft already exists;
- alert creation failure.

### `getMonitoringContext(location)`
Optional mocked operation if the sensor/triage UI is retained.

---

## 9. Final UI Flow

### Main flow

```text
DMC Dashboard
    ↓
Pending Reports
    ↓
Select Report
    ↓
Review:
photo + GPS/map + description + type + timestamp
    ↓
Officer chooses one:
VERIFY / REJECT
```

### Verify flow

```text
Verify
  ↓
Confirm
  ↓
PENDING -> VERIFIED
  ↓
Decision/audit stored
  ↓
Escalate becomes available
```

### Reject flow

```text
Reject
  ↓
Enter mandatory reason
  ↓
Confirm
  ↓
PENDING -> REJECTED
  ↓
Decision/audit stored
```

### Escalation flow

```text
VERIFIED report
  ↓
Escalate to Warning
  ↓
Create DRAFT Alert
  ↓
Open/pass to Broadcast Hazard Alert component
```

### Evidence error

```text
Evidence cannot load
  ↓
Show error + Retry
  ↓
Report remains PENDING
```

### Concurrent decision

```text
Another officer already processed report
  ↓
Show "Already processed"
  ↓
Refresh final status
  ↓
Disable Verify/Reject
```

### Connection problem

```text
Connection lost
  ↓
Refresh/check current report state
  ↓
Already final? show final state
Still PENDING? allow retry
```

### HCI/usability improvements
- neutral default: **No decision yet**;
- do not preselect VERIFIED;
- disable Escalate while pending;
- require rejection reason only when rejecting;
- label automated/sensor data **Advisory**;
- do not show automated warning/dispatch as already executed for a pending report;
- keep important evidence and decision controls clear for time-critical use.

---

## 10. Unit-Test Plan

Assignment 02 expects meaningful unit testing. Target **more than 80% coverage** for the strongest rubric band.

### Positive cases
1. load pending reports;
2. load complete report review details;
3. verify pending report;
4. reject pending report with reason;
5. store officer ID and decision time;
6. escalate verified report;
7. create draft alert from verified report.

### Negative cases
1. reject without reason;
2. decide already verified report;
3. decide already rejected report;
4. escalate pending report;
5. escalate rejected report;
6. unauthorized officer decision;
7. nonexistent report.

### Edge/boundary cases
1. empty pending queue;
2. maximum allowed rejection reason;
3. optional notes empty for verified decision;
4. sensor/triage data unavailable while core evidence is available;
5. trust score present but does not auto-decide.

### State-transition cases
1. `PENDING -> VERIFIED` succeeds;
2. `PENDING -> REJECTED` succeeds;
3. `VERIFIED -> REJECTED` fails;
4. `REJECTED -> VERIFIED` fails;
5. `PENDING -> Escalate` fails;
6. `VERIFIED -> Escalate` succeeds.

### Concurrency/retry cases
1. two officers decide the same report;
2. only first final decision succeeds;
3. retry after uncertain connection result;
4. duplicate escalation does not create unintended duplicate drafts.

### Failure/error cases
1. photo evidence temporarily fails to load;
2. map/GPS display temporarily fails;
3. database fails before transaction commit;
4. connection fails during decision;
5. draft-alert creation fails;
6. monitoring/sensor mock fails but core verification still works.

---

## 11. Revised UML Changes

### Use case diagram
The main structure is correct and should be preserved:

```text
DMC Duty Officer -> Verify Hazard Report
Escalate to Official Warning <<extend>> Verify Hazard Report
```

Recommended small clarification:

```text
Extension condition: [report.status = VERIFIED]
```

This makes the Case Study verification gate explicit.

---

### Class diagram

Keep:
- `DMCOfficer`
- `HazardReport`
- `Citizen`
- `Location`
- `Alert`
- `ReportStatus`

Add:
```text
VerificationDecision
VerificationResult
```

Revise verification method conceptually from:

```text
verifyReport(reportID, decision: ReportStatus): Boolean
```

to a decision operation that accepts:

```text
result: VerificationResult
reason: optional String
```

and creates/returns a `VerificationDecision`.

For Alert:
- add/coordinate an alert lifecycle/status that supports `DRAFT`.

If trust score remains in the final UI:
- model where that score comes from.

If sensor/auto-triage remains:
- represent it through an optional/mock monitoring service or remove unsupported fields from the final UI.

---

### Sequence diagram

The revised sequence must:

1. load all required core review data;
2. separate evidence-load error from rejection;
3. accept rejection reason;
4. create `VerificationDecision`;
5. check the report is still `PENDING`;
6. atomically save decision + final report state;
7. handle already-processed conflict;
8. handle retry safely after connection failure;
9. permit escalation only when `VERIFIED`;
10. create the alert as `DRAFT`.

---

## 12. Open Questions / Decisions Needed

The team must decide these before design freeze:

1. **Trust score:** keep it as advisory information or remove it?
2. **Sensor/auto-triage panel:** keep it using mocked data, or simplify the final UI?
3. **Officer notes:** optional for verified reports, or mandatory for all decisions?
4. **Verified report map:** confirm that "main map" means internal DMC operational map.
5. **Alert lifecycle:** confirm the shared Broadcast component states, including `DRAFT`.
6. **Reporter notification after VERIFIED:** optional usability improvement; the original scenario explicitly notifies on rejection but not on successful verification.

---

## Design Freeze Recommendation

- [ ] READY TO FREEZE
- [x] READY TO FREEZE AFTER LISTED CHANGES
- [ ] NOT READY TO FREEZE

### Exact unresolved decisions
Resolve the six open questions above and update the affected UML/UI artifacts before full implementation begins.

---

# Assignment 02 Compliance Check

This proposed review follows the Assignment 02 rules:

- preserves the original substantial use case;
- changes only issues with clear justification;
- reviews requirement coverage, logic, UML and HCI;
- links every proposed change to the critique;
- keeps implementation scope realistic;
- avoids using login/logout as the graded use case;
- keeps UI changes tied to the final storyboard/wireframes;
- includes meaningful positive, negative, edge, concurrency and failure testing;
- targets >80% meaningful test coverage;
- allows IoT/ML/sensor behavior to be mocked rather than requiring real hardware/services;
- requires the final implementation to follow the frozen changes exactly.


---

## Manual Sign-Off Before Sending to the Leader

Before sending this review, manually confirm these five points:

1. In the sequence diagram, the `REJECTED` call does not pass a rejection reason.
2. In the high-fidelity UI, `AWAITING VERIFICATION` and `VERIFIED • TIER 1` appear at the same time.
3. In the low-fidelity UI, the assessment/directives log is marked required with a minimum character count.
4. In the class diagram, `verifyReport` uses `ReportStatus`, and the `Alert` class does not clearly contain a `DRAFT` lifecycle/status.
5. Decide with the team whether “Automated Dispatches” are real actions or only advisory recommendations.

If these are confirmed, this review is ready to send to the group leader for design-freeze discussion.

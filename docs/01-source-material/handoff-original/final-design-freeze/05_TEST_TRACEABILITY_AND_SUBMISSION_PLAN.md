# Test Traceability and Submission Plan

## Quality target

Each feature owner must exceed 80 percent line and branch coverage for the owned module and must cover every frozen business transition, failure path and critique correction. Coverage is evidence, not a substitute for meaningful assertions.

Shared CI runs:

```text
install locked dependencies
lint
type-check
unit and integration tests
coverage threshold check
production builds for mobile, web and API
```

## Ownership and mandatory evidence

| Owner | Module | Mandatory test themes | Report evidence |
| --- | --- | --- | --- |
| Eshan | Submit Citizen Hazard Report | required evidence; GPS/manual pin; online submit; offline persistence; acknowledgement-before-delete; idempotent retry; outside-area flag | mobile screenshots for normal, validation, GPS fallback and pending-sync flows; coverage output |
| Javahir | Verify Hazard Report | pending queue; complete evidence; verify/reject; rejection reason; evidence load error remains pending; concurrency; decision transaction; escalation eligibility | web screenshots for review, reject, verify, evidence error and escalation; coverage output |
| Sandaruwan | Broadcast Hazard Alert | draft; validation; preview; duplicate rule; broadcast; push retry; SMS fallback; delivery status; versioned update; cancellation; idempotency; concurrency | web screenshots for draft, preview, active/delivery, update, cancel and failure states; coverage output |
| Shiham | Allocate Relief Resources | full/partial/zero-stock allocation; partner resupply; atomic rollback; stock concurrency; idempotency; request states; critical dispatch; occupancy non-regression | web screenshots for queue, allocation, shortage/partner, confirmation, receipt and conflict states; coverage output |

## End-to-end integration scenarios

### Scenario A Report to warning

1. Eshan submits a valid mobile report.
2. API acknowledges it as `PENDING`.
3. Javahir opens and verifies it.
4. Javahir escalates it to one `DRAFT` alert.
5. Sandaruwan completes the draft and broadcasts it.
6. Alert becomes `ACTIVE`, push deliveries start, and failures use SMS fallback.

Assertions:

- the same report ID is used through verification and alert source linkage;
- no component bypasses the verification gate;
- verification does not send a public alert;
- delivery results do not change report status.

### Scenario B Offline report retry

1. Mobile has no network and stores a local report as Pending Sync.
2. First synchronization reaches the server but the response is lost.
3. Mobile retries with the same `clientReportId`.
4. Server returns the existing report.
5. Mobile removes the local record only after acknowledgement.

Assertion: exactly one server report exists.

### Scenario C Partial relief allocation

1. Request asks for 100 water, 50 dry-ration packs and 20 medical kits.
2. Stock contains 100 water, 50 dry-ration packs and 8 medical kits.
3. Shiham allocates available stock and selects a partner for medical shortage.
4. Transaction commits 158 total units and a resupply request for 12 medical kits.
5. Request becomes `PARTIALLY_ALLOCATED`.

Assertions:

- stock reaches the expected values and never becomes negative;
- logs match allocated items;
- shelter occupancy is unchanged;
- retrying the command does not deduct stock again.

### Scenario D Concurrent conflicts

- Two DMC officers decide the same report; exactly one decision commits.
- Two DMC officers broadcast or update the same alert version; exactly one state transition commits.
- Two District Officers compete for the same stock; the second receives `STOCK_CHANGED` and the database remains consistent.

## Requirement-to-evidence matrix

| Assignment or design requirement | Design location | Code evidence | Test evidence | Report evidence |
| --- | --- | --- | --- | --- |
| Preserve and critique original design | Document 01 | corrected domain/application logic | regression tests for each critique | critique section with before, issue, correction and justification |
| Four substantial use cases | Documents 00 and 02 | four feature modules | owner-specific suites | member contribution table |
| Separate mobile reporting | Documents 00 and 02 | `apps/mobile` | mobile unit/component tests | mobile screenshots |
| UI follows revised design | Documents 03 and 04 plus revised UML/wireframes | implemented screens | component interaction tests | annotated screenshots and flow descriptions |
| Offline operation | Documents 01, 02 and 04 | local queue and idempotent API | Scenario B plus Eshan unit tests | Pending Sync and successful sync screenshots |
| Verification audit and safety | Documents 01, 02 and 04 | decision transaction | state, error and concurrency tests | decision UI and audit explanation |
| Reliable warning delivery | Documents 01, 02 and 04 | alert and delivery models | fallback, retry, update and cancel tests | delivery-status screenshots |
| Correct relief allocation | Document 03 | transaction, stock, resupply and dispatch services | all 43 Shiham tests | full/partial/conflict screenshots |
| Meaningful testing | This document | tests in every module | coverage above target and required branch suite | coverage tables and selected test results |
| AI usage disclosure | README and prompt log | `docs/ai-prompts` | not applicable | appendix containing full prompts |
| Repository and demo consistency | Document 06 | tagged final commit | CI on final commit | repo URL, commit hash and demo checklist |

## Test organization

```text
apps/api/src/modules/hazard-submission/**/*.test.ts
apps/api/src/modules/hazard-verification/**/*.test.ts
apps/api/src/modules/hazard-broadcast/**/*.test.ts
apps/api/src/modules/relief-allocation/**/*.test.ts
apps/mobile/src/features/hazard-reporting/**/*.test.tsx
apps/web/src/features/verification/**/*.test.tsx
apps/web/src/features/broadcast/**/*.test.tsx
apps/web/src/features/relief-allocation/**/*.test.tsx
apps/api/test/integration/*.test.ts
```

Use fake clocks for timestamps, deterministic UUIDs where useful, repository fakes for unit tests, and a disposable PostgreSQL test database for transaction/concurrency integration tests. Mock only external gateways, maps and sensors; do not mock the business rules under test.

## Final report structure

1. Cover page: group ID, campus, all registration numbers and member names.
2. Executive summary and system context.
3. Review method and source design overview.
4. Consolidated critique, organized by use case.
5. Revised high-level use-case diagram.
6. Revised class diagram.
7. Four revised sequence diagrams.
8. Architecture and cross-component decisions.
9. Implementation by component, identifying individual ownership.
10. UI screenshots with short step-by-step flow descriptions.
11. Testing strategy, ownership, cases, coverage and CI evidence.
12. Integration demonstration and limitations.
13. GitHub repository URL and final commit hash.
14. Conclusion.
15. Appendix containing every AI prompt used for assessed work.

Keep the report concise by moving full test lists, full prompts and supplementary screenshots to appendices. Every critique should use the same pattern: original design, problem, impact, correction, justification, affected artifacts and implementation evidence.

## Screenshot checklist

- Mobile report form with required evidence.
- GPS failure and manual pin.
- Pending Sync offline state.
- Server-acknowledged Pending Verification state.
- Verification queue and evidence view.
- Rejection reason validation.
- Verified state and escalation to draft.
- Alert draft, preview and recipient estimate.
- Similar-active-alert warning.
- Active alert with delivery summary and SMS fallback evidence.
- Alert update and cancellation/All Clear.
- Relief request ranked queue.
- Relief allocation with current stock.
- Partial shortage with partner selection.
- Confirmation summary and committed receipt.
- Critical-zone team dispatch.
- At least one handled conflict/error state per component.

## Final submission controls

- Add the official campus name before export.
- Add the real public/private-accessible GitHub URL as instructed by the lecturer.
- Run CI against the exact final commit.
- Record the final commit SHA in the report.
- Tag the release, for example `assignment-02-final`.
- Demonstrate only that tagged commit.
- Do not amend, force-push or add commits after the deadline.
- Export the compiled critique as one PDF.
- Open and visually inspect every PDF page.
- Verify that links, diagrams, captions and screenshots remain readable.
- Confirm that the AI appendix includes the prompts from planning, design, coding, debugging and document generation.

## Pre-submission placeholders

These fields must be filled later:

```text
Campus: [TO BE PROVIDED]
GitHub repository URL: [TO BE PROVIDED]
Final commit SHA: [TO BE PROVIDED]
Release tag: [TO BE PROVIDED]
Submission timestamp: [TO BE PROVIDED]
```

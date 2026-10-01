# Source Analysis and Final Resolutions

## Sources used

- Official `SE3070 - Case Study Assignment 02 Specification.pdf`, four pages, released 20 September 2026.
- Assignment 02 submission instructions pasted into the referenced conversation, including report, UI screenshot, GitHub URL and AI-prompt appendix requirements.
- Group 050 Assignment 01 PDF, including all four use-case scenarios.
- Original high-level use-case diagram.
- Original class diagram.
- Original sequence diagrams for submission, verification, broadcasting and relief allocation.
- Eshan's Hazard Reporting and Verification review.
- Javahir's Verify Hazard Report review.
- Sandaruwan's Broadcast Hazard Alert review.
- The group leader's clarification about ownership and the separate React Native mobile application.

## Assignment constraints carried forward

1. Preserve the original design where it is sound; correct major issues only with clear justification.
2. Each member implements one substantial use case and its relevant scenarios.
3. The final implementation must match the revised design and critique.
4. Each member supplies comprehensive, meaningful tests for their own component with more than 80 percent coverage, including positive, negative, edge and error cases with meaningful assertions.
5. IoT, sensors, notification gateways and similar external behavior may be mocked.
6. The group submits one PDF report containing the critique, UI screenshots with short flow descriptions, and the repository URL.
7. All AI prompts used for assessed work must be included in the report appendix.
8. The demonstrated code and submitted repository must match, and the repository must not be modified after the deadline.

## Ownership conflict resolved

Eshan's review combined submission and verification. That combination is rejected because the group leader explicitly assigned separate substantial use cases:

- Eshan owns only `Submit Citizen Hazard Report`.
- Javahir owns only `Verify Hazard Report`.

Submission produces a server-side `PENDING` report. Verification consumes it. Eshan may implement mobile status display and receive a decision outcome, but may not implement officer decision logic, `VerificationDecision`, or escalation.

## Cross-component decisions

| Decision area | Frozen decision | Reason |
| --- | --- | --- |
| Client applications | Separate React Native mobile app plus React web dashboard | Explicit group-leader decision; keeps citizen offline/mobile behavior separate from officer workflows |
| Architecture | TypeScript modular monolith | Sufficient for the assignment and easier to test and integrate than microservices |
| Hazard evidence | One photo, description, hazard type and location are required | Matches Assignment 01 and keeps review evidence consistent |
| GPS fallback | Manual map pin is allowed and records `MANUAL` as its source | Preserves the original alternate flow and makes the data explicit |
| Offline synchronization | Keep local record until acknowledged; unique `clientReportId` makes retries idempotent | Corrects the unsafe dequeue-before-ack sequence |
| Volunteer outside area | Accept the report and set `requiresExtraReview=true`; no numeric trust score | Preserves closer review without an unsupported scoring model |
| Report state | `QUEUED_OFFLINE` is local-only; server reports start at `PENDING` | Prevents mobile sync state from becoming a central verification state |
| Evidence load failure | Keep report `PENDING`; show Retry; do not auto-reject | Separates a technical failure from an officer decision |
| Verification notes | Optional on verify; rejection reason required | Matches the original rejection flow without adding unnecessary work |
| Verification concurrency | Conditional update from `PENDING` plus one unique decision per report | Prevents two officers from producing conflicting final decisions |
| Verified map | Internal DMC operational map only | Public warnings remain controlled by the broadcast component |
| Escalation | Only `VERIFIED` may create one linked `DRAFT` alert | Preserves the verification gate and component boundary |
| Alert channels | Push is primary; SMS is fallback after push failure | Matches the original `Trigger SMS Fallback` extension and sequence diagram |
| Alert activation | Alert becomes `ACTIVE` after the broadcast transaction commits and delivery work is accepted | Alert lifecycle is separated from per-recipient delivery outcomes |
| Alert duplicate rule | Existing `ACTIVE` alert with the same hazard type and at least one shared target zone | Deterministic and testable without advanced GIS |
| Alert update | New version becomes `ACTIVE`; only then does the prior version become `SUPERSEDED` | Prevents losing the current alert if an update fails |
| Draft removal | An unused draft may be discarded; `CANCELLED` is reserved for active alerts | Avoids an unnecessary `DRAFT -> CANCELLED` business transition |
| Gateway retry | Two push attempts total, then one SMS fallback attempt | Small fixed policy suitable for the assignment |
| Alert safety text | Required and non-blank; no unapproved minimum length | Removes the wireframe-only rule |
| Relief stock shortage | Partial allocation is supported and every shortage creates a partner resupply request | Avoids withholding available supplies and handles mixed-item requests explicitly |
| Relief occupancy | Allocation never changes `Shelter.currentOccupancy` | Corrects the central domain error in the original sequence |
| Stock concurrency | Conditional stock decrement inside a database transaction | Prevents overselling under concurrent officers |
| Critical transport | Optional only for a `CRITICAL` zone, with an available same-district team and at least one allocated item | Preserves the alternate flow with enforceable rules |

## Original design issues and required corrections

### Submit Citizen Hazard Report

- Original offline flow can remove all queued reports before acknowledgement. Replace it with per-report synchronization and delete locally only after a server acknowledgement.
- Retrying a submission can duplicate it. Add a unique `clientReportId` and return the existing report for repeated requests.
- A numeric trust score is not modeled. Replace it with `requiresExtraReview` and `outsideAssignedArea` flags.
- Make evidence rules identical in the mobile UI, API validation, UML and tests.

### Verify Hazard Report

- A technical photo or map loading failure must not automatically reject a report.
- Add `VerificationDecision` to hold result, reason, officer and timestamp.
- Enforce only `PENDING -> VERIFIED` or `PENDING -> REJECTED`.
- Save the report transition and decision in one transaction.
- Escalation creates a `DRAFT` alert; it does not broadcast.
- Remove or label sensor and auto-triage information as advisory. The frozen scope removes the unsupported sensor panel and retains only `requiresExtraReview` as advisory context.

### Broadcast Hazard Alert

- Separate alert lifecycle from delivery lifecycle.
- Resolve push-and-SMS versus SMS-fallback inconsistency in favor of push-primary and SMS-fallback.
- Extend `Alert` with source, creator, lifecycle, version and audit data.
- Add `NotificationDelivery` and `BroadcastAudit`.
- Model duplicate checks, retries, updates and cancellation in the revised sequence design.

### Allocate Relief Resources

- Replace direct `ReliefSupply` mutation calls with `ReliefRequest`, `WarehouseStock`, `ResourceAllocation`, `AllocationItem`, `DistributionLog` and `PartnerResupplyRequest`.
- Remove `updateShelterOccupancy()` from allocation. Occupancy is informational input maintained by shelter operations, outside this use case.
- Deduct stock, create allocation records, update request status and create distribution logs atomically.
- Add conditional stock updates and idempotency for safe concurrent/retried allocation.
- Support partial fulfillment per item; create partner resupply for every unmet quantity.
- Dispatch a transport team only after a valid allocation and atomically change `AVAILABLE -> EN_ROUTE`.

## Decisions intentionally excluded from scope

- Microservices, event brokers and advanced distributed transactions.
- Real push, SMS, GIS, IoT or sensor integrations; adapters may be mocked.
- Advanced polygon-overlap or proximity calculations.
- Numeric trust scoring or automated verification decisions.
- Verification appeals or reopening final reports.
- Partner resupply fulfillment workflows beyond creating and viewing a request.
- Shelter occupancy management.
- Full fleet routing or rescue-team return workflows.

## Blocker assessment

There is no remaining design blocker. The official Assignment 02 specification has been checked and the frozen design is consistent with it. Campus, repository URL, screenshots and final commit data remain submission-time placeholders.

# Strict Implementation Plan and Change Control

## Implementation principle

Build shared foundations once, then implement the four features against frozen contracts. A feature is not complete when only its happy path works; its state rules, tests, UI, UML and report evidence must all agree.

## Phase 0 Repository foundation

Owner: Shiham.

Deliverables:

- npm workspace with `apps/mobile`, `apps/web`, `apps/api` and shared packages;
- strict TypeScript configuration;
- linting and formatting;
- Vitest and coverage configuration;
- React Native application shell;
- React web application shell with role-based route groups;
- Express API shell and `/health` endpoint;
- PostgreSQL and Prisma development setup;
- environment-variable examples without secrets;
- GitHub Actions pipeline;
- pull-request template and contribution rules;
- copied design-freeze pack under `docs/design-freeze`.

The preferred team development database is PostgreSQL hosted by Neon. GitHub Actions continues to use its own temporary PostgreSQL service, while Docker PostgreSQL is an optional local fallback. Database credentials remain outside Git, and destructive work must use an isolated database or Neon branch.

Exit gate:

```text
install passes
lint passes
type-check passes
tests pass
mobile, web and API builds pass
CI passes from a clean checkout
```

## Phase 1 Shared contracts and schema

Owner: Shiham with review from all feature owners.

Implement only the enums, value objects, errors, IDs, validation schemas, tables and constraints frozen in documents 02 and 04. Add seed data for users, locations, zones, shelters, stock, partners, teams and representative requests.

Exit gate:

- migration applies to an empty database;
- migration rollback/reset process is documented;
- unique/check/foreign-key constraints are verified;
- no feature-specific business service is hidden in the shared package;
- every owner signs off on the types consumed by their module.

## Phase 2 Parallel feature implementation

### Eshan

Implement mobile reporting, GPS/manual pin, photo and description validation, local offline storage, safe synchronization, idempotent server submission, outside-area flag and report status display.

### Javahir

Implement pending queue, evidence review, verify/reject decision transaction, rejection reason, retry/current-state refresh, concurrency conflict and verified-only escalation.

### Sandaruwan

Implement alert drafts, preview, target zones, similar-alert check, broadcast activation, push retry, SMS fallback, delivery records, versioned update, cancellation and audit.

### Shiham

Implement the complete specification in document 03, including all transaction, resupply, dispatch, idempotency and test requirements.

Each feature branch must include code, tests, documentation updates and any revised UML affected by that feature.

## Phase 3 Cross-component integration

Integration order:

1. Eshan submission -> Javahir pending queue.
2. Javahir verified report -> Sandaruwan draft alert.
3. Sandaruwan active alert -> public-map query and mocked delivery adapters.
4. Shiham relief module -> shared district, location and target-zone data.
5. Full Scenario A, B, C and D runs from document 05.

No integration adapter may bypass an owning module's application service or write its tables directly.

## Phase 4 Revised design artifacts

Update and review:

- high-level use-case diagram;
- class diagram with all frozen entities and multiplicities;
- four sequence diagrams;
- mobile and web wireframes reflecting final states and error flows;
- API and database documentation.

Every class method shown in UML must map to implemented behavior, and every implemented assessed behavior must be visible in the scenario or supporting design documentation.

## Phase 5 Evidence and report

- reset to deterministic demo seed data;
- run CI and capture coverage evidence;
- capture screenshots in the order specified in document 05;
- execute the demo checklist against the intended final commit;
- compile critique, corrected design, implementation and test evidence;
- add repository URL and final commit SHA;
- add the complete AI prompt appendix;
- export and visually inspect the PDF.

## Phase 6 Release freeze

1. Merge only reviewed pull requests.
2. Run the full pipeline on the final commit.
3. Create the release tag.
4. Rehearse the demo from a clean checkout of that tag.
5. Record the SHA and tag in the report.
6. Submit before the deadline.
7. Do not modify the repository after the deadline.

## Pull-request gates

Every feature pull request must state:

- owned use case and member;
- frozen business rules implemented;
- revised UML/design references;
- tests added and coverage result;
- screenshots for UI changes;
- shared-contract changes, if any;
- migration impact;
- known limitations.

Required checks:

```text
lint
type-check
unit tests
integration tests affected by the change
coverage thresholds
mobile/web/API build as applicable
one teammate review
```

## Change-control rule

The design is frozen. Change it only when one of these occurs:

- the official Assignment 02 specification proves a frozen decision non-compliant;
- implementation reveals a correctness or security defect that cannot be fixed within the current contract;
- two frozen rules are demonstrably contradictory.

For any permitted change:

1. create an ADR containing the source, problem, affected components, alternatives and decision;
2. obtain approval from Shiham and every affected feature owner;
3. update the design-freeze documents, UML, API/data contracts and tests in the same pull request;
4. record the change in `docs/CHANGELOG.md`;
5. never merge an undocumented contract change.

New convenience features, visual preferences and speculative requirements do not qualify for a freeze change. Put them in a post-assignment backlog.

## Suggested branch order

```text
develop
  setup/repository-foundation
  architecture/shared-contracts
  feature/hazard-submission
  feature/hazard-verification
  feature/hazard-broadcast
  feature/relief-allocation
  integration/end-to-end
  docs/final-report
```

No one commits directly to `main`. Keep feature pull requests small enough to review and avoid mixing another member's business logic into the same pull request.

## Schedule guardrails

Work backward from the 9 October 2026 deadline:

- finish repository and frozen schema first;
- finish feature logic and owner tests before UI polishing;
- reserve a distinct integration period;
- reserve at least two days for diagrams, screenshots, report assembly, PDF verification and demo rehearsal;
- stop accepting non-essential changes once evidence capture begins.

Exact dates may be assigned by the team, but the order and exit gates above are fixed.

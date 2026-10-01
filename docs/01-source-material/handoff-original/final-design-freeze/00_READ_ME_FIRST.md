# Assignment 02 Final Design Freeze Pack

## Status

**Design status: FROZEN FOR IMPLEMENTATION**  
**Freeze date: 25 September 2026**  
**Assignment deadline: 9 October 2026 at 11:59 PM**

This pack is the implementation authority for the Group 050 review project. It reconciles the Assignment 02 requirements available in the project conversation, the Group 050 Assignment 01 design, the three teammate reviews, the supplied UML diagrams, and the group leader's ownership clarification.

When this pack conflicts with a teammate review, this pack wins. When it conflicts with the original Assignment 01 design, the change must be traceable to a documented critique in `01_SOURCE_ANALYSIS_AND_RESOLUTIONS.md`.

## Frozen ownership

| Member | Registration number | Frozen component | Required individual evidence |
| --- | --- | --- | --- |
| Shiham Ahamed A S | IT23690516 | Allocate Relief Resources | Implementation, unit tests, UI evidence, explanation; also repository setup, shared architecture, CI/CD and integration |
| Javahir N A | IT23697546 | Verify Hazard Report | Implementation, unit tests, UI evidence and explanation |
| Sandaruwan M P U | IT23860964 | Broadcast Hazard Alert | Implementation, unit tests, UI evidence and explanation |
| Eshan L W R | IT23857308 | Submit Citizen Hazard Report | Implementation, unit tests, mobile UI evidence and explanation |

Eshan does **not** own verification. Any verification proposals in Eshan's review are treated only as integration suggestions. Javahir's review is authoritative for verification.

## Frozen product shape

- `apps/mobile`: separate React Native application for citizen and volunteer hazard reporting.
- `apps/web`: React web dashboard for DMC Duty Officers and District Officers.
- `apps/api`: Node.js and TypeScript API implemented as a modular monolith.
- PostgreSQL with Prisma for persistent data.
- Shared TypeScript contracts and Zod validation packages.
- Vitest for unit and integration testing.
- GitHub Actions for lint, type-check, tests, coverage and build.

## Document order

1. `01_SOURCE_ANALYSIS_AND_RESOLUTIONS.md` - evidence, conflicts and final decisions.
2. `02_FROZEN_ARCHITECTURE_AND_DOMAIN.md` - system boundaries, shared language, entities and state machines.
3. `03_SHIHAM_ALLOCATE_RELIEF_RESOURCES.md` - complete individual component specification for Shiham.
4. `04_API_AND_DATA_CONTRACTS.md` - frozen conceptual endpoints, request/response rules and database constraints.
5. `05_TEST_TRACEABILITY_AND_SUBMISSION_PLAN.md` - test ownership, traceability, evidence and submission controls.
6. `06_IMPLEMENTATION_PLAN_AND_CHANGE_CONTROL.md` - strict build sequence, integration gates and change procedure.
7. `07_CODEX_IMPLEMENTATION_PROMPT.md` - prompt to start implementation with Codex.

## Non-negotiable implementation rules

- Do not merge feature code that contradicts the frozen state transitions or contracts.
- Each member writes and owns the tests for their component.
- Business state changes and their audit records must be atomic.
- Network retries must be idempotent and must not duplicate reports, decisions, alerts or allocations.
- Relief allocation must never change shelter occupancy.
- A citizen report cannot create a public warning until Javahir's verification flow marks it `VERIFIED` and Sandaruwan's broadcast flow activates an alert.
- The implementation, revised UML, screenshots, demonstration and final report must describe the same behavior.
- Record all AI prompts used for assessed work in the report appendix.

## Remaining non-design inputs

Implementation can begin now. The following are still needed before final submission but do not block design freeze:

- campus name for the report cover page;
- final GitHub repository URL;
- final screenshots and short flow descriptions;
- final demonstration recording or live-demo checklist;
- final repository commit hash and confirmation that the repository was not changed after the deadline.

The official four-page Assignment 02 specification has now been checked against this pack. It confirms the frozen approach: one collaborative critique covering four substantial use cases, one substantial implementation per member, exact implementation of the proposed changes, maintainable code, storyboard/wireframe consistency, and comprehensive meaningful unit tests with more than 80 percent coverage for the highest rubric band.

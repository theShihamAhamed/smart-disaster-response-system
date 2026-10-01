# Codex Prompt for Implementation

Copy the prompt below into Codex after placing this complete design-freeze folder in the repository.

## Prompt

You are implementing SE3070 Assignment 02 for a four-member team. Treat every file in `docs/design-freeze` as a frozen implementation contract. Read all of them before editing code, especially the architecture/domain file, API/data contracts, Shiham's relief specification, test plan and change-control rules.

Team ownership is fixed:

- IT23690516 Shiham Ahamed A S: Allocate Relief Resources, repository setup, architecture, CI/CD and integration.
- IT23697546 Javahir N A: Verify Hazard Report.
- IT23860964 Sandaruwan M P U: Broadcast Hazard Alert.
- IT23857308 Eshan L W R: Submit Citizen Hazard Report only. Eshan does not own verification.

The product must contain a separate React Native mobile app for citizen/volunteer reporting, a React web dashboard for officers, and a TypeScript API modular monolith using PostgreSQL and Prisma. Use npm workspaces, strict TypeScript, Zod, Vitest, ESLint, Prettier and GitHub Actions.

Start with Phase 0 and Phase 1 only:

1. Inspect the existing repository and preserve unrelated or user-owned changes.
2. Create or complete this structure:

```text
apps/mobile
apps/web
apps/api
packages/domain
packages/shared-types
packages/shared-validation
packages/api-client
packages/config
docs/design-freeze
docs/revised-uml
docs/testing
docs/report
docs/ai-prompts
```

3. Configure strict TypeScript, formatting, linting, tests, coverage and workspace scripts.
4. Create minimal mobile, web and API shells. The API must expose `GET /health`.
5. Configure PostgreSQL and Prisma.
6. Implement only the shared enums, value objects, error envelope, base authorization model, Prisma entities and database constraints explicitly frozen in the design documents.
7. Add deterministic seed data for all four feature areas.
8. Add CI steps for locked install, lint, type-check, tests with coverage and all builds.
9. Add a pull-request template aligned with the frozen implementation plan.
10. Do not implement the four full feature workflows yet.

Critical rules:

- Do not invent new statuses, entity names, endpoints or business rules.
- Do not combine submission and verification ownership.
- Keep `QUEUED_OFFLINE` local to the mobile application; server report states are `PENDING`, `VERIFIED` and `REJECTED`.
- Relief allocation must never update shelter occupancy.
- Alert lifecycle and delivery lifecycle are separate.
- Mutating retry-sensitive operations must support the frozen idempotency rules.
- Shared packages must not contain feature business services.
- If the current repository conflicts with a frozen contract, stop that specific change and report the exact conflict. Do not silently choose a different design.
- Log this prompt and any later AI prompts in `docs/ai-prompts/AI_PROMPT_LOG.md` for the assignment appendix.

Before declaring Phase 0 and Phase 1 complete:

- run install from the lockfile;
- run lint;
- run type-check;
- run all tests;
- run coverage checks;
- build mobile, web and API;
- apply migrations to a clean database;
- run seeds;
- report files changed, commands run, results, remaining risks and the next feature branch to start.

After Phase 0 and Phase 1 pass and receive team review, implement each feature in a separate branch or task, following the order and ownership in `06_IMPLEMENTATION_PLAN_AND_CHANGE_CONTROL.md`.


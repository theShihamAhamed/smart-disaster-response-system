# ChatGPT to Codex Project Initialization Handoff

## Purpose

Use this handoff to start a new ChatGPT conversation, verify the frozen project design, obtain one final Codex initialization prompt, initialize the repository in VS Code, publish the foundation to GitHub, and then let each member implement only their assigned component.

## Files to upload to the new ChatGPT chat

### Original source material

Upload these first because they are the evidence against which the prepared decisions must be checked:

1. `SE3070 - Case Study Assignment 02 Specification.pdf`
2. `SE3070 Assignment 01 (1).pdf`
3. Original high-level use-case diagram
4. Original class diagram
5. Original Submit Citizen Hazard Report sequence diagram
6. Original Verify Hazard Report sequence diagram
7. Original Broadcast Hazard Alert sequence diagram
8. Original Allocate Relief Resources sequence diagram
9. The three teammate review documents, if available

### Prepared project documents

Upload every file in these two folders:

```text
final-design-freeze/
member-component-plans/
```

Also upload `01_MASTER_CHATGPT_ANALYSIS_PROMPT.md`, or paste its content after all attachments finish uploading.

## Authority order

If two documents conflict, use this order:

1. Official Assignment 02 specification
2. Explicit ownership decisions from the group leader
3. `final-design-freeze` documents
4. Individual member component plans
5. Teammate review documents
6. Original Group 050 Assignment 01 design

The original Group 050 design is evidence to critique, not an instruction to preserve known errors. However, changes must remain limited and justified because the assignment requires the original design to be preserved as much as possible.

## Frozen ownership

| Member | Registration number | Component |
| --- | --- | --- |
| Shiham Ahamed A S | IT23690516 | Allocate Relief Resources |
| Javahir N A | IT23697546 | Verify Hazard Report |
| Sandaruwan M P U | IT23860964 | Broadcast Hazard Alert |
| Eshan L W R | IT23857308 | Submit Citizen Hazard Report only |

Eshan does not own verification. Each member implements and tests their own substantial use case. Shiham additionally owns the initial repository setup, shared architecture, CI/CD and integration.

## Frozen application shape

```text
apps/mobile  - React Native citizen and volunteer application
apps/web     - React officer dashboards
apps/api     - Node.js and TypeScript backend API
```

The API is a modular monolith backed by PostgreSQL and Prisma. Shared packages contain contracts, validation and configuration but not feature business services.

## Required workflow

### Step 1 New ChatGPT analysis

Upload the source material and prepared documents. Paste the master prompt. Ask ChatGPT to identify only genuine conflicts or missing decisions. It must not redesign the system or generate application code.

### Step 2 Obtain the Codex initialization prompt

ChatGPT should return one self-contained prompt for Codex covering only repository foundation and shared architecture. Save that prompt in the project under:

```text
docs/08-ai-prompts/INITIAL_CODEX_BOOTSTRAP_PROMPT.md
```

It must also be retained for the final report's AI appendix.

### Step 3 Initialize in VS Code

1. Open an empty project folder in VS Code.
2. Open the Codex extension chat.
3. Make all prepared documents available inside the workspace, preferably under `docs/design-freeze/`.
4. Paste the ChatGPT-generated Codex prompt.
5. Let Codex inspect the folder before creating files.
6. Require Codex to install dependencies, run validation commands and report exact results.

### Step 4 Verify before GitHub upload

The repository foundation is acceptable only when:

- mobile, web and API workspaces exist;
- strict TypeScript is enabled;
- lint and formatting are configured;
- tests and coverage commands run;
- PostgreSQL and Prisma foundation exists;
- the health endpoint works;
- environment examples contain no secrets;
- deterministic seed data can be loaded;
- GitHub Actions validates lint, types, tests, coverage and builds;
- all prepared documentation is stored in the repository;
- the four full business features have not been prematurely implemented.

### Step 5 Publish and share

1. Review Codex's changes.
2. Commit the verified foundation.
3. Push it to GitHub.
4. Protect or carefully control `main`.
5. Create `develop` and one feature branch per member.
6. Share the repository and the member-specific document with each teammate.

Recommended branches:

```text
feature/hazard-submission
feature/hazard-verification
feature/hazard-broadcast
feature/relief-allocation
```

### Step 6 Team development

- Each member follows only their component plan and frozen shared contracts.
- Each member writes their own tests and must exceed 80 percent meaningful coverage.
- Shared enum, database or API contract changes require group-leader review.
- Every pull request must pass CI and be reviewed by at least one teammate.
- Screenshots, test evidence and AI prompts must be retained for the final report.

## What must not happen during initialization

- Do not implement the four complete business components.
- Do not combine submission and verification.
- Do not allow Codex to invent new statuses, entities or endpoints.
- Do not create a second web implementation for the mobile reporting application.
- Do not put feature business logic in shared packages.
- Do not commit secrets or real credentials.
- Do not treat login/logout as an assessed substantial use case.
- Do not omit the documents from the repository.


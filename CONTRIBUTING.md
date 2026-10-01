# Contributing

Use `main` only for reviewed, release-ready work and integrate active work through `develop`. Do not implement features directly on `main`.

## Feature branches

- `feature/hazard-submission`
- `feature/hazard-verification`
- `feature/hazard-broadcast`
- `feature/relief-allocation`

Each owner implements and meaningfully tests their own assessed use case. Pull requests require one teammate review and passing installation, formatting, lint, type-check, test, coverage, Prisma and build checks.

Every pull request must identify the owner/use case, frozen rules implemented, tests and coverage, UML/document impact, schema migration impact, UI screenshots where relevant, shared-contract changes and known limitations.

Frozen contracts change only when the official specification proves non-compliance, an implementation correctness/security defect cannot be resolved within the contract, or two frozen rules contradict. Such a change requires an ADR, approval from Shiham and every affected owner, synchronized design/UML/API/test updates and a changelog entry.

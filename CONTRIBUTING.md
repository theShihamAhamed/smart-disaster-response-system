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

## Database safety

- Never commit `.env` or share database passwords through Git. Copy `.env.example` and keep real connection strings only in the ignored `.env` file.
- Use `npm run db:migrate:deploy` to apply committed migrations to the shared development database. Do not create ad hoc production-style changes outside Prisma migrations.
- Coordinate every Prisma schema or migration change with the group leader. Feature owners must not alter the frozen shared schema without approval.
- Treat seed operations as shared-state changes and coordinate them before targeting a shared Neon branch.
- Never casually run `prisma migrate reset`, `prisma db push --force-reset`, or equivalent destructive commands against the team's shared Neon environment. Use an isolated developer database/branch, or obtain explicit coordination from the group leader first.

# Smart Disaster Early-Warning and Emergency Coordination System

This repository is the shared implementation foundation for SE3070 Assignment 02. It is intentionally limited to Phase 0 (repository and application foundations) and Phase 1 (frozen shared contracts and database foundations). The four assessed end-to-end business workflows are not implemented yet.

## Architecture

- `apps/mobile`: separate Expo and React Native TypeScript shell for citizens and volunteers.
- `apps/web`: React, TypeScript and Vite shell for DMC Duty Officers and District Officers.
- `apps/api`: Express and TypeScript modular-monolith foundation with `GET /health` and `GET /api/v1/health`.
- `packages/domain`: frozen enums and small pure cross-component invariants.
- `packages/shared-types`: API error, authorization and metadata types.
- `packages/shared-validation`: Zod schemas for shared primitives and enums.
- `packages/api-client`: typed HTTP client foundation and health client.
- `packages/config`: shareable application configuration constants.
- PostgreSQL and Prisma provide persistence.

No feature application service, controller or repository is placed in a shared package.

## Ownership

| Member            | Registration number | Assessed component                | Additional responsibility                              |
| ----------------- | ------------------- | --------------------------------- | ------------------------------------------------------ |
| Shiham Ahamed A S | IT23690516          | Allocate Relief Resources         | Repository, shared architecture, CI/CD and integration |
| Javahir N A       | IT23697546          | Verify Hazard Report              | Component implementation and tests                     |
| Sandaruwan M P U  | IT23860964          | Broadcast Hazard Alert            | Component implementation and tests                     |
| Eshan L W R       | IT23857308          | Submit Citizen Hazard Report only | Component implementation and tests                     |

Submission and verification remain separate components. Eshan's component does not own officer decisions, `VerificationDecision` or verified-only escalation.

## Requirements

- Node.js 22 and npm 10
- Docker Desktop or another PostgreSQL 17-compatible server

## Local setup

1. Copy `.env.example` to `.env` and change the local-only placeholder password if needed.
2. Run `npm ci` after the lockfile exists (use `npm install` only when intentionally updating dependencies).
3. Start PostgreSQL with `docker compose up -d postgres`.
4. Run `npm run db:migrate:deploy`.
5. Run `npm run db:seed` and `npm run db:verify-seed`.
6. Run `npm run dev` to start the three application shells.

The Docker Compose defaults are development placeholders, not production credentials.

## Commands

| Command                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `npm run dev`               | Start mobile, web and API development processes   |
| `npm run build`             | Build shared packages and all application shells  |
| `npm run lint`              | Run ESLint                                        |
| `npm run format:check`      | Check Prettier formatting                         |
| `npm run typecheck`         | Run strict TypeScript checks in every workspace   |
| `npm test`                  | Run foundation tests                              |
| `npm run test:coverage`     | Run tests with enforced coverage thresholds       |
| `npm run db:validate`       | Validate the Prisma schema                        |
| `npm run db:migrate:deploy` | Apply committed migrations                        |
| `npm run db:seed`           | Load deterministic valid demo records             |
| `npm run db:verify-seed`    | Verify deterministic record counts and key states |

## Database reset and recreation

For a disposable local database, stop the service and remove only the named Compose volume, then start PostgreSQL again and run migration, seed and verification:

```text
docker compose down -v
docker compose up -d postgres
npm run db:migrate:deploy
npm run db:seed
npm run db:verify-seed
```

`docker compose down -v` deletes local database data. Never use it against a database containing needed information.

## Phase boundary

This foundation deliberately does not implement Submit Citizen Hazard Report, Verify Hazard Report, Broadcast Hazard Alert or Allocate Relief Resources. Their conceptual API contracts remain documented under `docs/04-architecture`; Phase 2 owners must implement them on their feature branches without changing frozen ownership, states or invariants.

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
- PostgreSQL and Prisma provide persistence; Neon hosts the preferred shared development database.

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
- Access to the team's Neon project for the recommended shared development workflow
- Docker Desktop only when using the optional local PostgreSQL fallback

## Local setup

1. Obtain access to the team's Neon development project and the appropriate database branch.
2. Copy `.env.example` to `.env`.
3. Put the Neon pooled connection string in `DATABASE_URL` and the direct/unpooled connection string in `DIRECT_DATABASE_URL`.
4. Run `npm ci` (use `npm install` only when intentionally updating dependencies).
5. Run `npm run db:validate`, `npm run db:migrate:deploy`, `npm run db:seed` and `npm run db:verify-seed`.
6. Run `npm run dev` to start the three application shells.

See [Neon development setup](docs/04-architecture/NEON_DEVELOPMENT_SETUP.md) for team branch guidance and database safety rules.

For an officer web demonstration, set `VITE_API_BASE_URL` and a selected seeded officer UUID in `VITE_DEV_USER_ID` in the ignored root `.env` file, set `WEB_ORIGIN` to the exact web origin allowed by the API, and explicitly enable the API with `DEV_AUTH_ENABLED=true`. These browser-visible values are development/demo configuration, not secrets or production authentication. Mobile continues to use `EXPO_PUBLIC_API_BASE_URL`.

## Database setup

### Recommended: Neon PostgreSQL

Neon is the hosted provider for the team's development PostgreSQL databases. It does not change the architecture: the applications still access PostgreSQL through Prisma.

After the group leader creates the Neon project, use the pooled connection string for normal application traffic and the direct connection string for Prisma migration commands. Keep both values only in the uncommitted `.env` file. Then run:

```text
npm ci
npm run db:validate
npm run db:migrate:deploy
npm run db:seed
npm run db:verify-seed
npm run dev
```

Coordinate migration and seed operations before running them against a shared database. Never run `prisma migrate reset` against a shared Neon environment.

### Optional local PostgreSQL fallback

The existing Docker Compose service remains available for isolated work and recovery. To use it, start `docker compose up -d postgres` and set both database variables in your uncommitted `.env` to the local service:

```dotenv
DATABASE_URL="postgresql://disaster_app:phase1_dev_only@localhost:5433/disaster_management?schema=public"
DIRECT_DATABASE_URL="postgresql://disaster_app:phase1_dev_only@localhost:5433/disaster_management?schema=public"
```

These Docker Compose values are development placeholders, not production credentials. Docker is not required for the normal Neon workflow.

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

## Optional local database reset and recreation

For a disposable local database, stop the service and remove only the named Compose volume, then start PostgreSQL again and run migration, seed and verification:

```text
docker compose down -v
docker compose up -d postgres
npm run db:migrate:deploy
npm run db:seed
npm run db:verify-seed
```

`docker compose down -v` deletes the optional local Docker database volume. For any Prisma reset or destructive database operation, first confirm that the active URLs point to an isolated disposable database, never a shared Neon branch.

## Phase boundary

This foundation deliberately does not implement Submit Citizen Hazard Report, Verify Hazard Report, Broadcast Hazard Alert or Allocate Relief Resources. Their conceptual API contracts remain documented under `docs/04-architecture`; Phase 2 owners must implement them on their feature branches without changing frozen ownership, states or invariants.

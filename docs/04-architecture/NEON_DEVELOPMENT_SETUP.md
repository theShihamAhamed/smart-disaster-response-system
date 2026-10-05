# Neon Development Setup

## Environment roles

| Concern                            | Choice                                         |
| ---------------------------------- | ---------------------------------------------- |
| Database technology                | PostgreSQL                                     |
| ORM                                | Prisma                                         |
| Shared hosted development provider | Neon                                           |
| CI database                        | Temporary PostgreSQL service in GitHub Actions |
| Optional local fallback            | Docker PostgreSQL                              |

Neon changes only where development PostgreSQL is hosted. It does not change the application architecture, Prisma models, migrations, domain rules or CI isolation.

## Recommended Neon structure

Create one Neon project named `smart-disaster-response-system`. If the team's Neon plan supports the required branches, use:

- `main`
- `develop`
- `shiham-relief`
- `eshan-submission`
- `javahir-verification`
- `sandaruwan-broadcast`

Separate member branches let developers test independently, keep seed/test operations away from another member's working data, isolate schema checks and make destructive development work safer. The group leader must create and manage these branches later; no Neon resources are created by this repository.

A simpler alternative is one shared `develop` database. When using it, coordinate migrations and seed operations, and never run `prisma migrate reset`, `prisma db push --force-reset`, or an equivalent destructive command. Prefer separate member database branches for feature development when available.

## Connection variables

Copy `.env.example` to the ignored `.env` file. Set:

- `DATABASE_URL` to the Neon pooled connection string for normal application traffic.
- `DIRECT_DATABASE_URL` to the matching Neon direct/unpooled connection string for Prisma CLI migration operations.

Keep the database, role and branch consistent between the two URLs. Preserve Neon-provided TLS parameters, URL-encode special characters in credentials and never commit either value.

This repository uses Prisma 6.19. The datasource's supported `directUrl` setting directs Prisma CLI operations that require a direct connection away from the pooled runtime URL.

The deterministic seed uses a longer transaction timeout because hosted PostgreSQL network latency is higher than local PostgreSQL latency.

## Initial setup for a database branch

After access and connection strings are available:

```text
npm ci
npm run db:validate
npm run db:migrate:deploy
npm run db:seed
npm run db:verify-seed
npm run dev
```

Use committed migrations only. Coordinate before migrating or seeding a shared branch. No new schema migration is required merely to adopt Neon because Neon provides standard PostgreSQL.

## CI independence and local fallback

GitHub Actions supplies both Prisma URL variables with its own CI-only PostgreSQL service URL. It does not need Neon credentials or a Neon API key and remains reproducible if Neon is unavailable.

For isolated local work, start the existing Docker PostgreSQL service and point both URL variables at that same local database. The exact fallback values and reset warning are documented in the root README.

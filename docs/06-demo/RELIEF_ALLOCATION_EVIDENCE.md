# Allocate Relief Resources evidence

Owner: Shiham Ahamed A S (`IT23690516`)

## Validated flow

The District Officer web workflow was validated against the running Express API and shared Neon development database. The CRITICAL request was used for one minimal partial allocation: one Water unit was allocated, the remaining Water and Medical Kit shortages were assigned to the eligible partner, and the available rescue team was dispatched. The authoritative receipt, refreshed queue and refreshed request details all reflected the committed state.

The first live POST exposed Prisma's default interactive-transaction timeout under hosted database latency. The existing atomic allocation transaction now uses transaction-local `maxWait: 10_000` and `timeout: 60_000` options; retrying the same logical command and idempotency key then committed once, and a subsequent replay returned the same receipt with HTTP 200.

The HIGH request was taken to confirmation as a resupply-only command without submitting it. The UI retained zero warehouse quantities, required a partner for each shortage, omitted rescue selection and previewed `AWAITING_RESUPPLY`. Its database state was left unchanged.

## Traceability

| Behavior                      | Endpoint                                              | Primary implementation                                                                            | Main automated evidence                                                                                     |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Ranked district queue         | `GET /api/v1/relief-requests`                         | `ReliefQueuePage.tsx`, `relief-read-service.ts`                                                   | `ReliefQueuePage.test.tsx`, `relief-read-service.test.ts`                                                   |
| Request workspace             | `GET /api/v1/relief-requests/:requestId`              | `ReliefWorkspacePage.tsx`, `prisma-relief-read-repository.ts`                                     | `ReliefWorkspacePage.test.tsx`, `relief-read-routes.test.ts`                                                |
| Atomic allocation             | `POST /api/v1/relief-requests/:requestId/allocations` | `ReliefWorkspacePage.tsx`, `relief-command-service.ts`, `prisma-relief-allocation-transaction.ts` | `ReliefWorkflow.test.tsx`, `relief-command-service.test.ts`, `prisma-relief-allocation-transaction.test.ts` |
| Same-key recovery             | `GET /api/v1/allocations/by-idempotency-key/:key`     | `ReliefWorkspacePage.tsx`, `prisma-relief-command-repository.ts`                                  | `ReliefWorkflow.test.tsx`, `prisma-relief-command-repository.test.ts`                                       |
| Conflict handling             | allocation POST error contract                        | `ReliefWorkspacePage.tsx`, `relief-command-controller.ts`                                         | `ReliefConflicts.test.tsx`, `relief-command-routes.test.ts`                                                 |
| PostgreSQL races and rollback | internal transaction port                             | `prisma-relief-allocation-transaction.ts`                                                         | `prisma-relief-allocation-transaction.integration.test.ts` in isolated PostgreSQL CI                        |

## Concise screenshot plan

1. Ranked queue - demonstrates server order, urgency, shelter pressure and outstanding demand.
2. Allocation workspace - demonstrates read-only shelter context and the demand-versus-stock boundary.
3. Partial allocation - demonstrates positive warehouse allocation plus mandatory partner coverage for shortages.
4. Confirmation - demonstrates separation of warehouse, resupply and optional rescue intent before commit.
5. Receipt - demonstrates the authoritative `PARTIALLY_ALLOCATED` result, committed items, resupply and dispatch.
6. Resupply-only confirmation - demonstrates zero warehouse allocation, required partners and no rescue dispatch.
7. Recovery or conflict state - demonstrates same-key recovery or a safe typed-conflict next action using controlled test data.

## Evidence controls

- Capture final screenshots only from the final reviewed commit.
- Do not show browser developer tools, credentials or raw environment values.
- Use isolated PostgreSQL CI for destructive, rollback and concurrency evidence; never use shared Neon for those cases.
- Record the final feature-branch or pull-request CI URL after the branch is pushed.

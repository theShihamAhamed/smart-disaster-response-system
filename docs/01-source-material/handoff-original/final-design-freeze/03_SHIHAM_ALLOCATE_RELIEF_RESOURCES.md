# Allocate Relief Resources Final Component Specification

## Member and scope

**Owner:** Shiham Ahamed A S  
**Registration number:** IT23690516  
**Primary actor:** District Officer  
**Component:** Allocate Relief Resources

This is Shiham's substantial individual use case. It covers reviewing prioritized relief requests, checking synchronized district stock, allocating available supplies, requesting partner resupply for shortages, and optionally dispatching an available transport or rescue team for a critical target zone. Shelter occupancy management, procurement fulfillment and fleet return are outside scope.

## Corrected use-case scenario

### Goal

Allocate the greatest safely available quantity to an eligible relief request without overselling warehouse stock, losing an audit trail, duplicating a retry, or changing unrelated shelter occupancy data.

### Preconditions

- The actor is an authenticated `DISTRICT_OFFICER`.
- The request belongs to the officer's district.
- The request status is `AWAITING_ALLOCATION`, `PARTIALLY_ALLOCATED` or `AWAITING_RESUPPLY`.
- At least one request item has an outstanding quantity.
- The warehouse ledger is reachable and its current stock can be read.
- The shelter and target zone are active and in the same district as the request.

### Ranked request queue

The queue order is deterministic:

1. target-zone severity descending: `CRITICAL`, `HIGH`, `MODERATE`, `LOW`;
2. shelter occupancy rate descending, calculated as `currentOccupancy / capacity`;
3. request creation time ascending.

Occupancy is used only for ranking and display. Allocation must not update it.

### Main flow

1. The system displays eligible requests in ranked order.
2. The officer opens one request.
3. The system displays shelter name, occupancy and capacity, target zone and severity, location, request notes, requested quantities, previously allocated quantities, outstanding quantities, and current synchronized stock.
4. The system confirms that the request and target zone belong to the officer's district.
5. For each outstanding item, the officer enters an allocation quantity from zero up to the smaller of outstanding quantity and currently available stock.
6. The system highlights any remaining shortage.
7. For every shortage, the officer selects an active partner organisation in the same district. One partner may cover multiple shortages.
8. If the zone is `CRITICAL` and at least one item will be allocated, the officer may select one `AVAILABLE` same-district rescue or transport team.
9. The system shows a confirmation summary containing stock deductions, remaining stock, shortages, resupply requests, request status outcome, and optional dispatch.
10. The officer confirms once and sends an idempotency key with the command.
11. In one database transaction, the API rechecks request state/version, stock and team availability; conditionally deducts stock; creates the allocation and allocation items; creates distribution logs; creates partner resupply requests; updates request status; and optionally creates the dispatch while changing the team from `AVAILABLE` to `EN_ROUTE`.
12. The system commits and displays a receipt. Repeating the same idempotency key returns the existing receipt without changing stock again.

### Partial allocation rule

Partial allocation is frozen as supported.

For each request item:

```text
outstandingQty = requestedQty - sum(previous allocatedQty)
chosenQty must satisfy 0 <= chosenQty <= min(outstandingQty, availableQty)
shortageQty = outstandingQty - chosenQty
```

- If every outstanding item is fully covered, the request becomes `ALLOCATED`.
- If at least one unit is allocated but a shortage remains, the request becomes `PARTIALLY_ALLOCATED`.
- If no unit is allocated and a shortage is forwarded to partners, the request becomes `AWAITING_RESUPPLY`.
- Every positive shortage must produce one `PartnerResupplyRequest` for its supply type.
- An allocation command with all quantities zero is valid only when it creates at least one resupply request.

### Emergency transport dispatch

Dispatch is optional and allowed only when all conditions hold:

- target-zone severity is `CRITICAL`;
- allocation contains at least one positive quantity;
- selected team belongs to the officer's district;
- team status is still `AVAILABLE` at commit time.

The transaction conditionally changes `AVAILABLE -> EN_ROUTE` and creates `TransportDispatch`. If the team is no longer available, the entire command fails with a conflict so the officer can reselect a team; stock is not deducted.

### Failure and alternate flows

#### Ledger unavailable or stale

- Disable Confirm.
- Show `Stock Sync Error` with Retry.
- Do not write any allocation, stock, log, resupply or dispatch record.

#### Stock changed before confirmation

- The conditional decrement fails.
- Roll back the entire transaction.
- Return `409 STOCK_CHANGED` with the latest stock snapshot.
- Keep the officer's draft values in the UI and require reconfirmation.

#### Request already completed or version changed

- Roll back and return `409 REQUEST_CHANGED`.
- Refresh outstanding quantities and current status.

#### Rescue team no longer available

- Roll back and return `409 TEAM_UNAVAILABLE`.
- Do not silently allocate without the requested dispatch.

#### Connection lost after confirmation

- The client keeps the same idempotency key and queries or retries the command.
- If the first command committed, the API returns the existing receipt.
- If it did not commit, the retry performs the transaction once.

#### No stock for any requested item

- Require partner selection for every shortage.
- Create resupply requests and set `AWAITING_RESUPPLY`.
- Do not create zero-valued allocation items or a meaningless distribution log.

#### Officer cancels before confirmation

- Discard the client-side draft only.
- No server state changes.

## Business rules

- **BR-REL-01:** Only a District Officer may allocate relief resources.
- **BR-REL-02:** An officer may act only on requests and stock in the officer's district.
- **BR-REL-03:** The request, shelter and target zone must belong to the same district.
- **BR-REL-04:** Allocation uses outstanding quantity, not the original requested quantity alone.
- **BR-REL-05:** Allocated quantity must be a whole number greater than or equal to zero.
- **BR-REL-06:** A positive allocation may not exceed either outstanding demand or current stock.
- **BR-REL-07:** Warehouse stock must never become negative.
- **BR-REL-08:** Stock deduction, allocation records, logs, resupply records, request status and dispatch are one atomic unit.
- **BR-REL-09:** Partial allocation is allowed.
- **BR-REL-10:** Every positive shortage requires a partner resupply request before confirmation.
- **BR-REL-11:** Only an active same-district organisation may receive a resupply request.
- **BR-REL-12:** A request becomes `ALLOCATED` only when all items are completely fulfilled across all committed allocations.
- **BR-REL-13:** Allocating supplies must not update shelter occupancy or capacity.
- **BR-REL-14:** A rescue team may be dispatched only for a `CRITICAL` zone with a positive committed allocation.
- **BR-REL-15:** Only an `AVAILABLE` same-district team may transition to `EN_ROUTE`.
- **BR-REL-16:** The allocation command is idempotent by officer plus idempotency key.
- **BR-REL-17:** A repeated idempotency key with a different payload is rejected as `409 IDEMPOTENCY_MISMATCH`.
- **BR-REL-18:** Distribution logs are append-only.
- **BR-REL-19:** Stock quantities and request quantities are non-negative integers.
- **BR-REL-20:** The UI cannot claim success until the server returns a committed receipt.

## Required domain behavior

### `ReliefRequest.calculateOutstanding()`

Returns the outstanding quantity per request item after all prior committed allocations.

### `ReliefRequest.deriveStatus()`

- no outstanding quantity -> `ALLOCATED`;
- allocated total greater than zero and shortage remains -> `PARTIALLY_ALLOCATED`;
- no allocated total and active resupply exists -> `AWAITING_RESUPPLY`;
- otherwise -> `AWAITING_ALLOCATION`.

### `WarehouseStock.reserveAndDeduct()`

Uses a conditional database update that succeeds only if the current available quantity is at least the requested deduction. It cannot be implemented as an unchecked read followed by write.

### `ResourceAllocation.create()`

Rejects duplicate idempotency commands, zero or negative line items, item types absent from the request, over-allocation and cross-district actions.

### `RescueTeam.dispatch()`

Conditionally changes an available team to `EN_ROUTE`. A second dispatch attempt must fail.

## Transaction design

```text
BEGIN
  validate authenticated District Officer and district scope
  find existing receipt by officerId + idempotencyKey
  if found: compare request hash and return existing receipt
  lock/re-read ReliefRequest and request items
  re-calculate outstanding quantities
  for each positive allocation item:
      conditionally decrement WarehouseStock where availableQty >= chosenQty
      require exactly one row updated
  validate every shortage has an active partner
  if dispatch requested:
      conditionally update RescueTeam AVAILABLE -> EN_ROUTE
      require exactly one row updated
  create ResourceAllocation
  create AllocationItems
  create DistributionLogs
  create PartnerResupplyRequests for shortages
  create TransportDispatch when selected
  derive and update ReliefRequest.status and version
COMMIT
```

Any failed check triggers rollback. Use a transaction isolation level and conditional updates appropriate for PostgreSQL. Retry transient serialization failures at most twice inside the API; return a conflict if safe completion is still impossible.

## UI specification

### Screen 1 Relief request queue

- ranked request cards or table;
- filters for status, severity and district-fixed target zone;
- visible shelter occupancy as `current/capacity` and percentage;
- status badge and request age;
- no editable occupancy control.

### Screen 2 Allocation workspace

- read-only shelter, location and zone summary;
- request-item grid with requested, previously allocated, outstanding, available and allocate-now columns;
- immediate validation for quantity limits;
- shortage panel with partner selection per supply type;
- optional team selector visible only for `CRITICAL` zones;
- allocation notes, maximum 500 characters;
- disabled Confirm while stock is unavailable or validation fails.

### Screen 3 Confirmation

- before/after warehouse stock;
- allocation quantities;
- shortage and partner requests;
- derived request status;
- selected team and destination, if any;
- one final Confirm button protected against double submission.

### Screen 4 Receipt

- allocation ID and timestamp;
- committed item quantities;
- resupply request IDs;
- dispatch ID and team status where applicable;
- final request status;
- link back to the queue.

## Revised sequence specification

The revised UML sequence diagram must use these lifelines:

```text
DistrictOfficer
ReliefAllocationUI
ReliefAllocationController
ReliefAllocationService
ReliefRequestRepository
WarehouseStockRepository
PartnerOrganisationRepository
RescueTeamRepository
DatabaseTransaction
```

It must show:

1. ranked request retrieval;
2. details and synchronized stock retrieval;
3. client validation and confirmation;
4. idempotency lookup;
5. transaction start;
6. request/state/version recheck;
7. loop over positive allocation items with conditional stock decrement;
8. alternate path for stock conflict and rollback;
9. loop over shortages creating resupply requests;
10. optional critical-zone team dispatch with conditional state update;
11. allocation, item and distribution-log creation;
12. request-status derivation;
13. commit and receipt;
14. connection-loss retry returning the same receipt.

The diagram must not contain `updateShelterOccupancy()`.

## Test plan

### Core success tests

1. Full single-item allocation sets `ALLOCATED` and deducts exact stock.
2. Full multi-item allocation creates one allocation with all item and distribution records.
3. Partial allocation sets `PARTIALLY_ALLOCATED` and creates exact resupply quantities.
4. Zero-stock request creates resupply requests and sets `AWAITING_RESUPPLY`.
5. Later allocation completes a partially allocated request.
6. Critical-zone allocation dispatches an available team to `EN_ROUTE`.
7. Receipt contains allocation, resupply and dispatch identifiers.

### Validation and authorization tests

8. Non-District Officer is forbidden.
9. Officer cannot allocate a request in another district.
10. Request/shelter/zone district mismatch is rejected.
11. Negative, fractional and non-numeric quantities are rejected.
12. Allocation over outstanding quantity is rejected.
13. Allocation over available stock is rejected.
14. Unknown supply type or item is rejected.
15. Shortage without an active partner is rejected.
16. Inactive or cross-district partner is rejected.
17. Notes longer than 500 characters are rejected.

### State tests

18. Completed request cannot be allocated again.
19. `AWAITING_ALLOCATION -> ALLOCATED` is valid.
20. `AWAITING_ALLOCATION -> PARTIALLY_ALLOCATED` is valid.
21. `AWAITING_ALLOCATION -> AWAITING_RESUPPLY` is valid.
22. `PARTIALLY_ALLOCATED -> ALLOCATED` is valid.
23. Request status is derived from totals, not trusted from the client.

### Concurrency and transaction tests

24. Two officers competing for insufficient stock cannot produce negative stock.
25. A failed second stock decrement rolls back earlier decrements in the same command.
26. Allocation-record failure rolls back stock.
27. Distribution-log failure rolls back stock and allocation.
28. Resupply-record failure rolls back the command.
29. Team conflict rolls back stock and allocation.
30. Request version conflict rolls back the command.

### Idempotency tests

31. Same key and same payload returns the original receipt.
32. Same key does not deduct stock twice.
33. Same key with different payload returns `IDEMPOTENCY_MISMATCH`.
34. Retry after an uncertain connection returns the committed result.

### Dispatch tests

35. Non-critical request cannot dispatch a team.
36. Zero-allocation resupply request cannot dispatch a team.
37. `EN_ROUTE` team cannot be dispatched again.
38. `UNAVAILABLE` team cannot be dispatched.
39. Cross-district team cannot be dispatched.

### Regression tests for the critique

40. Allocation does not change `Shelter.currentOccupancy`.
41. Allocation does not change `Shelter.capacity`.
42. Queue ranking uses severity, occupancy rate and age in the frozen order.
43. Ledger-unavailable response performs no writes.

The component target is more than 80 percent line and branch coverage, but all state, concurrency, rollback and idempotency tests above are mandatory even if the percentage target has already been reached.

## Definition of done for Shiham

- Revised use-case text, class diagram and sequence diagram match this file.
- API and database constraints match document 04.
- All mandatory tests pass locally and in CI.
- Coverage target is met for the relief module.
- Four UI screens are implemented and responsive.
- At least one screenshot documents each main and alternate flow used in the report.
- Demo seed data includes full allocation, partial allocation, stock conflict and critical dispatch scenarios.
- No allocation code writes shelter occupancy.
- Pull request is reviewed by at least one teammate and merged without bypassing CI.

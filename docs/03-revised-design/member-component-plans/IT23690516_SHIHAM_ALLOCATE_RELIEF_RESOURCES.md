# Allocate Relief Resources Final Component Plan

## Member and assignment scope

**Member:** Shiham Ahamed A S  
**Registration number:** IT23690516  
**Assigned substantial use case:** Allocate Relief Resources  
**Primary actor:** District Officer  
**Application:** React web dashboard

Shiham owns the relief-allocation workflow and its tests. Shiham also coordinates repository setup, shared architecture, database foundations, CI/CD and integration, but those duties do not replace the individual use-case implementation.

## Rubric target

For the highest individual marks, implement all allocation scenarios end to end and exactly follow the revised design; deliver excellent UX; use clean, well-structured, maintainable and documented code with SOLID principles, correct patterns and no recurring code smells; and exceed 80 percent meaningful unit-test coverage across positive, negative, edge and error cases.

## Original Group 050 design to preserve

- A District Officer reviews shelters or target zones with open relief requests.
- Requests are ranked by need using severity and occupancy information.
- The officer reviews shelter, request and GIS information.
- The officer checks synchronized district warehouse stock.
- The officer allocates dry rations, water, tents and medical kits.
- Stock is deducted and distribution is logged.
- Insufficient stock creates a partner-organisation resupply request.
- A critical zone may receive an emergency rescue/transport team.
- Ledger and connection failures prevent unsafe allocation.

## Problems, corrections and justifications

| ID | Problem in the Group 050 design | Final correction | Justification |
| --- | --- | --- | --- |
| REL-01 | The scenario and sequence update shelter occupancy after allocating supplies. | Allocation never changes `Shelter.currentOccupancy` or capacity. Occupancy is read-only ranking/display input maintained by shelter operations. | Delivering supplies does not change the number of people in a shelter. This is the central domain error. |
| REL-02 | `allocateResources(itemId, qty, zone): Boolean` hides the request, actor, multiple items, audit and result. | Introduce `ReliefRequest`, request items, `ResourceAllocation`, allocation items and a typed allocation receipt. | Represents the substantial workflow accurately and improves traceability. |
| REL-03 | Stock is deducted through a simple Boolean method without an atomic transaction. | Recheck and conditionally decrement stock inside one transaction with allocation, logs, status, resupply and optional dispatch. | Prevents stock deduction without a saved allocation or vice versa. |
| REL-04 | Two officers can allocate the same limited stock concurrently. | Use conditional updates such as `availableQty >= chosenQty`, request/team version checks and transaction rollback on conflict. | Guarantees stock never becomes negative. |
| REL-05 | Insufficient stock only forwards the whole request, leaving mixed-item behavior undefined. | Support partial allocation. Allocate chosen available quantities and create a partner resupply request for every remaining shortage. | Makes available emergency supplies usable immediately and explicitly handles mixed stock. |
| REL-06 | The original model has no proper request status for partial or zero-stock resupply. | Use `AWAITING_ALLOCATION`, `PARTIALLY_ALLOCATED`, `AWAITING_RESUPPLY` and `ALLOCATED`, derived from totals. | Gives the queue and UI accurate lifecycle information. |
| REL-07 | Retrying after connection loss can deduct stock twice. | Require an officer-scoped idempotency key. Same key and payload return the original receipt; same key with different payload conflicts. | Makes an uncertain network outcome safe. |
| REL-08 | Emergency dispatch does not prove the team is still available or in the same district. | Allow only a same-district `AVAILABLE` team for a `CRITICAL` zone with a positive allocation; conditionally change it to `EN_ROUTE` in the allocation transaction. | Prevents double dispatch and invalid cross-district assignments. |
| REL-09 | The original class diagram places stock logging and allocation behavior in broad actor/supply classes. | Add explicit stock, allocation, distribution, partner-resupply and dispatch entities with repository/service boundaries. | Improves UML correctness, maintainability and testing. |
| REL-10 | Queue ranking is described but not deterministic. | Rank by zone severity descending, occupancy rate descending, then request creation time ascending. | Makes UI, implementation and tests consistent. |

## Final use-case scenario

### Preconditions

- The actor is an authenticated District Officer.
- The request belongs to the officer's district.
- Request status is `AWAITING_ALLOCATION`, `PARTIALLY_ALLOCATED` or `AWAITING_RESUPPLY`.
- At least one request item has outstanding demand.
- Shelter, target zone and warehouse stock are valid and in the same district.
- The warehouse ledger is reachable.

### Ranked queue

Order eligible requests by:

1. `CRITICAL`, `HIGH`, `MODERATE`, `LOW` zone severity;
2. occupancy rate descending (`currentOccupancy / capacity`);
3. oldest request first.

### Main allocation flow

1. The officer opens a ranked request.
2. The UI shows shelter, read-only occupancy/capacity, zone, severity, location and request note.
3. For each item, show requested, previously allocated, outstanding and current stock.
4. The officer chooses an allocate-now quantity from zero through the smaller of outstanding demand and stock.
5. The system recalculates shortages.
6. For every shortage, the officer selects an active same-district NGO, Armed Forces organisation or Private Donor.
7. For a `CRITICAL` zone with positive allocation, the officer may select one available same-district rescue/transport team.
8. A confirmation screen shows stock before/after, allocated quantities, shortages, partners, derived status and optional dispatch.
9. The officer confirms once with an idempotency key.
10. The API rechecks request version, outstanding totals, current stock, partner eligibility and team availability.
11. In one transaction it deducts stock, creates allocation/items/logs, creates shortage resupply requests, updates request status and optionally creates a dispatch with `AVAILABLE -> EN_ROUTE`.
12. The UI displays the committed receipt.

### Partial allocation rule

For every item:

```text
outstanding = requested - sum(previous committed allocations)
0 <= chosen <= min(outstanding, current stock)
shortage = outstanding - chosen
```

- No shortage across all items -> `ALLOCATED`.
- Some allocation and some shortage -> `PARTIALLY_ALLOCATED`.
- No allocation and partner requests created -> `AWAITING_RESUPPLY`.
- A positive shortage requires a partner before confirmation.
- Do not create zero-valued allocation items or distribution logs.

### Stock/request/team conflict

- Roll back the whole transaction.
- Return a typed conflict such as `STOCK_CHANGED`, `REQUEST_CHANGED` or `TEAM_UNAVAILABLE`.
- Refresh current data and require the officer to review and confirm again.
- Never keep a partial stock deduction.

### Connection loss after confirmation

- Preserve the idempotency key.
- Query or retry using the same key.
- Return the existing receipt if the command committed.
- Execute once if it did not commit.

## Final business rules

- Only a District Officer may allocate.
- Officer, request, shelter, zone, warehouse, partner and team must be within the same district where applicable.
- Quantities are non-negative whole numbers.
- Allocation may not exceed outstanding demand or current stock.
- Warehouse stock never becomes negative.
- Partial allocation is allowed.
- Every positive shortage requires an active partner resupply request.
- Request status is derived on the server from committed totals.
- Stock, allocation, distribution logs, resupply requests, request status and requested dispatch commit atomically.
- Allocation never changes shelter occupancy or capacity.
- Dispatch requires a critical zone, a positive allocation and an available same-district team.
- A dispatched team changes `AVAILABLE -> EN_ROUTE` once.
- Allocation commands are idempotent.
- Distribution logs are append-only.
- UI success appears only after a committed server receipt.

## States and transitions

```text
AWAITING_ALLOCATION -> ALLOCATED
AWAITING_ALLOCATION -> PARTIALLY_ALLOCATED
AWAITING_ALLOCATION -> AWAITING_RESUPPLY
PARTIALLY_ALLOCATED -> PARTIALLY_ALLOCATED
PARTIALLY_ALLOCATED -> ALLOCATED
AWAITING_RESUPPLY -> PARTIALLY_ALLOCATED
AWAITING_RESUPPLY -> ALLOCATED
```

Team:

```text
AVAILABLE -> EN_ROUTE
```

The return-to-available workflow is outside this use case.

## Required domain objects

- `Shelter`: district, location, capacity and read-only current occupancy.
- `ReliefRequest`: shelter, target zone, status, note, creation time and version.
- `ReliefRequestItem`: supply type and requested quantity.
- `WarehouseStock`: district, supply type, available quantity, version and sync time.
- `ResourceAllocation`: request, officer, unique idempotency key, notes and timestamp.
- `AllocationItem`: allocation, request item, supply type and positive allocated quantity.
- `DistributionLog`: append-only allocation item, district, quantity and time.
- `PartnerOrganisation`: same-district active NGO, Armed Forces or Private Donor.
- `PartnerResupplyRequest`: request, partner, supply type, shortage and status.
- `RescueTeam`: district and `AVAILABLE`, `EN_ROUTE` or `UNAVAILABLE` state.
- `TransportDispatch`: allocation, team, destination and dispatch time.

## Required application operations

- `listRankedReliefRequests()` applies the frozen order.
- `getReliefRequestDetails()` returns request totals, current stock, partners and teams.
- `calculateOutstanding()` derives remaining demand.
- `createAllocation()` performs the idempotent transaction.
- `getAllocationByIdempotencyKey()` resolves uncertain results.
- `deriveRequestStatus()` calculates status from committed totals.
- `dispatchRescueTeam()` is invoked only within the valid allocation transaction.

## UI flow and HCI requirements

### Request queue

- Ranked requests with severity, occupancy rate, age and status.
- Clear empty state and filters.
- Occupancy is displayed but never editable.

### Allocation workspace

- Read-only shelter/zone/location context.
- Per-item requested, allocated, outstanding, available and allocate-now values.
- Immediate quantity validation.
- Shortage panel requiring a partner per supply type.
- Team selector visible only for critical eligible requests.
- Notes up to 500 characters.
- Confirm disabled when ledger or validation is invalid.

### Confirmation and receipt

- Show before/after stock, item allocations, shortages/partners, final status and dispatch.
- Protect Confirm from double submission.
- Receipt contains allocation, resupply and dispatch identifiers.
- Conflict retains the user's draft but requires review of refreshed data.

## Revised UML requirements

### Use-case diagram

- Keep District Officer -> Allocate Relief Resources.
- Rename/clarify `Check Shelter Capacity` as `Review Shelter Need and Capacity`; it is informational and does not update occupancy.

### Class diagram

- Add all explicit relief entities listed above.
- Replace broad Boolean allocation methods with an application service returning a receipt.
- Remove `updateShelterOccupancy()` from the allocation behavior.
- Show one request to many items and allocations; one allocation to positive items/logs and optional dispatch.

### Sequence diagram

Show ranked retrieval, synchronized details, confirmation, idempotency lookup, transaction start, request recheck, looped conditional stock deductions, rollback conflict branch, shortage/resupply loop, optional conditional dispatch, allocation/items/logs, status derivation, commit and idempotent retry. Never show occupancy mutation.

## Unit-test plan

### Positive cases

1. Full single-item allocation.
2. Full multi-item allocation.
3. Partial allocation with exact resupply shortages.
4. Zero-stock resupply-only result.
5. Later allocation completes a partial request.
6. Critical allocation dispatches an available team.
7. Receipt contains allocation, resupply and dispatch identifiers.

### Negative and validation cases

8. Non-District Officer forbidden.
9. Cross-district request forbidden.
10. Request/shelter/zone district mismatch rejected.
11. Negative, fractional or non-numeric quantities rejected.
12. Quantity over outstanding demand rejected.
13. Quantity over current stock rejected.
14. Unknown request item/supply type rejected.
15. Shortage without partner rejected.
16. Inactive or cross-district partner rejected.
17. Notes over 500 characters rejected.
18. Completed request cannot be allocated again.

### State and edge cases

19. Each valid request transition derives correctly.
20. Status sent by the client is ignored.
21. Exact stock equals outstanding demand.
22. One of several items has zero stock.
23. Queue ranking resolves severity, equal severity by occupancy, and equal occupancy by age.

### Transaction and concurrency cases

24. Competing officers cannot create negative stock.
25. Failure on a later item rolls back earlier deductions.
26. Allocation creation failure rolls back stock.
27. Distribution-log failure rolls back everything.
28. Resupply creation failure rolls back everything.
29. Team conflict rolls back stock and allocation.
30. Request version conflict rolls back.
31. Ledger unavailable performs no writes.

### Idempotency and dispatch cases

32. Same key and payload return original receipt.
33. Same key does not deduct twice.
34. Same key with different payload conflicts.
35. Uncertain result retry returns committed receipt.
36. Non-critical request cannot dispatch.
37. Zero-allocation resupply cannot dispatch.
38. `EN_ROUTE` or `UNAVAILABLE` team cannot dispatch.
39. Cross-district team cannot dispatch.

### Critique regression cases

40. Allocation does not change current occupancy.
41. Allocation does not change shelter capacity.
42. Distribution logs equal committed positive item quantities.
43. Stock never becomes negative under concurrency.

Target more than 80 percent line and branch coverage. All concurrency, rollback, idempotency and critique-regression tests remain mandatory even if the percentage is already achieved.

## Code-quality expectations

- Use a clear allocation application service and explicit transaction boundary.
- Keep quantity/status rules in domain functions, not controllers or React components.
- Depend on repository interfaces and typed gateway errors.
- Use conditional database updates rather than unchecked read-then-write.
- Keep idempotency handling centralized.
- Avoid an anemic Boolean-return design; return a typed receipt or typed error.
- Make test fixtures deterministic and readable.

## Required implementation and report evidence

- Ranked request queue.
- Allocation workspace with synchronized stock.
- Full allocation receipt.
- Partial allocation plus partner resupply.
- Zero-stock/resupply behavior.
- Critical dispatch and team state.
- Stock/request/team conflict behavior.
- Evidence that occupancy remains unchanged.
- Coverage above 80 percent and representative test output.
- Revised class and sequence diagrams matching implementation.

## Definition of done

- All original allocation scenarios and corrections above are implemented.
- Stock, logs, status, resupply and dispatch are transactionally consistent.
- Concurrency and retries cannot over-allocate or duplicate deductions.
- Shelter occupancy is never written by this module.
- UI matches revised storyboard/wireframes.
- All mandatory tests pass with more than 80 percent coverage.
- UML, code, screenshots and report describe the same workflow.


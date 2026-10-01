# Frozen API and Data Contracts

## General API rules

- Base path: `/api/v1`.
- JSON request and response bodies.
- IDs are UUID strings.
- Dates are UTC ISO 8601 strings.
- Quantities are non-negative integers.
- Validation errors return `422` with field errors.
- Authorization failures return `401` or `403`.
- Missing resources return `404`.
- State, version, duplicate and stock conflicts return `409` with a stable error code.
- Dependency outages such as an unreachable stock ledger return `503`.
- Mutating retry-sensitive operations require an `Idempotency-Key` header.

Error envelope:

```json
{
  "error": {
    "code": "STOCK_CHANGED",
    "message": "Warehouse stock changed. Review the latest quantities and confirm again.",
    "fieldErrors": {},
    "details": {}
  }
}
```

The server never trusts a client-provided role, owner, final status, available stock, outstanding quantity, recipient count or derived request state.

## Submit Citizen Hazard Report

### `POST /hazard-reports`

Header: `Idempotency-Key: <clientReportId>`

```json
{
  "clientReportId": "uuid",
  "hazardType": "FLOOD",
  "description": "Flood water is crossing the main road.",
  "photoRef": "uploaded-object-reference",
  "location": {
    "latitude": 6.9271,
    "longitude": 79.8612,
    "source": "GPS"
  }
}
```

Frozen validation:

- one photo is required;
- description is 10 to 500 trimmed characters;
- hazard type must be in the shared enum;
- latitude and longitude must be valid;
- manual pins use `source=MANUAL`;
- `clientReportId` must equal the idempotency key.

Response `201`, or `200` for an idempotent repeat:

```json
{
  "reportId": "uuid",
  "clientReportId": "uuid",
  "status": "PENDING",
  "outsideAssignedArea": false,
  "requiresExtraReview": false,
  "submittedAt": "2026-09-25T10:00:00Z"
}
```

Offline queueing is a mobile application operation, not a server endpoint. The mobile record is deleted only after this acknowledgement is stored locally.

### `GET /hazard-reports/{reportId}/status`

Accessible to the report owner. Returns `PENDING`, `VERIFIED` or `REJECTED`; a rejection response includes the stored reason.

## Verify Hazard Report

### `GET /verification/reports?status=PENDING`

Returns the authorized officer's pending queue. Pagination and simple district filtering are allowed without changing the contract.

### `GET /verification/reports/{reportId}`

Returns core evidence: report ID, hazard type, description, photo reference, location, district, submitted time, status and `requiresExtraReview`. Sensor or auto-triage data is excluded from the frozen scope.

### `POST /verification/reports/{reportId}/decision`

Header: `Idempotency-Key: <decision-command-uuid>`

```json
{
  "result": "REJECTED",
  "reason": "Photo does not show the reported flood location."
}
```

Rules:

- only `PENDING` can be decided;
- `reason` is required for `REJECTED`, 10 to 500 trimmed characters;
- `reason` is optional for `VERIFIED`;
- unique final decision per report;
- state update and decision record commit together.

Conflicts use `409 REPORT_ALREADY_PROCESSED` and return the current final status.

### `POST /verification/reports/{reportId}/escalations`

Header: `Idempotency-Key: <escalation-command-uuid>`

Creates one `DRAFT` alert only when the report is `VERIFIED`. An idempotent repeat returns the existing draft. This operation is implemented in the broadcast module and called from the verification workflow.

## Broadcast Hazard Alert

### `POST /alerts/from-report/{reportId}`

Creates or returns the unique initial draft for a verified source report.

### `PATCH /alerts/{alertId}`

Edits a `DRAFT` only. Fields: severity, message, safety instructions and target-zone IDs. Message and safety instructions must be non-blank; no frozen character minimum is imposed beyond a shared practical maximum of 1000 characters each.

### `GET /alerts/{alertId}/preview`

Returns the draft and an estimated recipient count. The estimate is not a delivery guarantee.

### `GET /alerts/{alertId}/similar-active`

Returns active alerts with the same hazard type and at least one shared target zone.

### `POST /alerts/{alertId}/broadcast`

Header: `Idempotency-Key: <broadcast-command-uuid>`

Requires explicit confirmation in the UI. The transaction checks the draft state, required content, target zones and similar-alert conflict; changes the alert to `ACTIVE`; creates audit data; and queues delivery records. If that transaction fails, the alert remains `DRAFT`.

### `POST /alerts/{alertId}/replacement-drafts`

Creates a new version from an `ACTIVE` alert. Broadcasting the replacement atomically activates it and supersedes the old alert. A failed replacement leaves the old alert active.

### `POST /alerts/{alertId}/cancel`

Header: `Idempotency-Key: <cancel-command-uuid>`

```json
{ "reason": "Flood water has receded." }
```

Only `ACTIVE` may be cancelled. The transaction sets `CANCELLED`, removes it from active-map queries and creates All Clear delivery work. Delivery failure is recorded but does not reactivate the alert.

### `POST /alerts/{alertId}/deliveries/retry`

Retries only eligible failed deliveries for the same alert. Frozen policy: two push attempts total, then one SMS attempt. Retries never create a second alert.

## Allocate Relief Resources

### `GET /relief-requests`

Query parameters may include status and zone severity. The server fixes district scope from the authenticated officer. Default order is frozen priority order.

### `GET /relief-requests/{requestId}`

Returns request, shelter, zone, item totals, previous allocations, outstanding quantities, current warehouse stock, eligible partner organisations and eligible teams.

### `POST /relief-requests/{requestId}/allocations`

Header: `Idempotency-Key: <allocation-command-uuid>`

```json
{
  "requestVersion": 4,
  "items": [
    { "requestItemId": "uuid", "quantity": 100 },
    { "requestItemId": "uuid", "quantity": 8 }
  ],
  "shortages": [
    {
      "requestItemId": "uuid",
      "partnerOrganisationId": "uuid"
    }
  ],
  "rescueTeamId": "uuid",
  "notes": "Medical kits partially allocated; remainder sent to NGO."
}
```

The client sends partner selections, not trusted shortage quantities. The server recalculates every shortage after re-reading stock and outstanding demand.

Response `201`, or `200` for an idempotent repeat:

```json
{
  "allocationId": "uuid",
  "requestId": "uuid",
  "requestStatus": "PARTIALLY_ALLOCATED",
  "items": [
    { "supplyType": "WATER", "allocatedQty": 100 },
    { "supplyType": "MEDICAL_KIT", "allocatedQty": 8 }
  ],
  "resupplyRequests": [
    { "id": "uuid", "supplyType": "MEDICAL_KIT", "requestedQty": 12, "status": "REQUESTED" }
  ],
  "dispatch": {
    "id": "uuid",
    "teamId": "uuid",
    "status": "EN_ROUTE"
  },
  "createdAt": "2026-09-25T10:00:00Z"
}
```

Stable conflict codes:

- `STOCK_CHANGED`
- `REQUEST_CHANGED`
- `REQUEST_ALREADY_ALLOCATED`
- `TEAM_UNAVAILABLE`
- `IDEMPOTENCY_MISMATCH`
- `PARTNER_REQUIRED`

### `GET /allocations/by-idempotency-key/{key}`

Returns the officer's committed allocation receipt after an uncertain network result. It must not expose another officer's commands.

## Database constraints

Minimum required unique and check constraints:

```text
HazardReport.clientReportId UNIQUE
VerificationDecision.reportId UNIQUE
Alert(sourceReportId) UNIQUE WHERE parentAlertId IS NULL
AlertTargetZone(alertId, targetZoneId) UNIQUE
ReliefRequestItem(requestId, supplyType) UNIQUE
WarehouseStock(districtId, supplyType) UNIQUE
ResourceAllocation(officerId, idempotencyKey) UNIQUE
PartnerResupplyRequest(reliefRequestId, partnerOrganisationId, supplyType, status)
  protected against duplicate active REQUESTED records
AllocationItem.allocatedQty > 0
WarehouseStock.availableQty >= 0
Shelter.capacity > 0
Shelter.currentOccupancy >= 0
ReliefRequestItem.requestedQty > 0
PartnerResupplyRequest.requestedQty > 0
```

Foreign keys must prevent orphaned decisions, alerts, allocations, distribution logs, resupply requests and dispatches. Audit and distribution records are append-only through application permissions.

## Authorization matrix

| Operation | Citizen | Volunteer | DMC Duty Officer | District Officer |
| --- | ---: | ---: | ---: | ---: |
| Submit own hazard report | Yes | Yes | No | No |
| View own report status | Yes | Yes | No | No |
| View pending verification queue | No | No | Yes | No |
| Verify or reject report | No | No | Yes | No |
| Escalate verified report | No | No | Yes | No |
| Create or broadcast alert | No | No | Yes with permission | No |
| View district relief queue | No | No | No | Yes, own district |
| Allocate resources | No | No | No | Yes, own district |

Authentication mechanics may be simple for the assignment, but authorization checks must exist in the API and have unit tests.


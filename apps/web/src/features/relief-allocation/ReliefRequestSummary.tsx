import type { ReliefRequestDetails } from "@disaster/shared-types";

import { formatDateTime, formatSupplyType } from "./relief-ui";

export function ReliefRequestSummary({ details }: { readonly details: ReliefRequestDetails }) {
  const occupancyPercentage = Math.round(details.shelter.occupancyRate * 100);

  return (
    <section className="relief-summary" aria-label="Selected request and shelter context">
      <div className="relief-note" role="note">
        <span aria-hidden="true">!</span>
        <div>
          <p className="relief-kicker">Shelter request note</p>
          <strong>{details.priorityNote || "No priority note provided."}</strong>
        </div>
      </div>

      <div className="relief-summary__context">
        <article className="relief-info-panel">
          <p className="relief-kicker">Request record</p>
          <dl>
            <div>
              <dt>Request ID</dt>
              <dd className="relief-mono">{details.requestId}</dd>
            </div>
            <div>
              <dt>Requested</dt>
              <dd>{formatDateTime(details.createdAt)}</dd>
            </div>
            <div>
              <dt>Target zone</dt>
              <dd>{details.targetZone.name}</dd>
            </div>
          </dl>
        </article>

        <article className="relief-info-panel">
          <p className="relief-kicker">Shelter occupancy</p>
          <div className="relief-occupancy">
            <strong>
              <span>{details.shelter.currentOccupancy}</span>
              <span aria-hidden="true"> / </span>
              <span>{details.shelter.capacity}</span>
            </strong>
            <span>{occupancyPercentage}% occupied</span>
          </div>
          <div
            className="relief-occupancy__meter"
            role="meter"
            aria-label={`${details.shelter.name} occupancy`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, occupancyPercentage)}
          >
            <span style={{ width: `${Math.min(100, occupancyPercentage)}%` }} />
          </div>
          <p className="relief-readonly-note">
            Read-only prioritization data. Resource allocation does not change shelter occupancy.
          </p>
        </article>

        <article className="relief-info-panel relief-info-panel--location">
          <p className="relief-kicker">Verified shelter location</p>
          <h3>{details.shelter.name}</h3>
          <p>{details.shelter.location.address || "No street address supplied"}</p>
          <dl>
            <div>
              <dt>Coordinates</dt>
              <dd>
                {details.shelter.location.latitude.toFixed(4)},{" "}
                {details.shelter.location.longitude.toFixed(4)}
              </dd>
            </div>
          </dl>
        </article>
      </div>

      <section className="relief-stock" aria-labelledby="relief-stock-heading">
        <div className="relief-section-heading">
          <div>
            <p className="relief-kicker">Warehouse stock snapshot</p>
            <h2 id="relief-stock-heading">Demand and current stock</h2>
          </div>
          <p>Stock is revalidated only when the allocation is confirmed.</p>
        </div>
        <div className="relief-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Supply</th>
                <th scope="col">Requested</th>
                <th scope="col">Previous</th>
                <th scope="col">Outstanding</th>
                <th scope="col">Available</th>
                <th scope="col">Stock synced</th>
              </tr>
            </thead>
            <tbody>
              {details.items.map((item) => (
                <tr key={item.requestItemId}>
                  <th scope="row">{formatSupplyType(item.supplyType)}</th>
                  <td>{item.requestedQty}</td>
                  <td>{item.previouslyAllocatedQty}</td>
                  <td>
                    <strong>{item.outstandingQty}</strong>
                  </td>
                  <td>{item.warehouseStock.availableQty}</td>
                  <td>{formatDateTime(item.warehouseStock.syncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="relief-history" aria-labelledby="relief-history-heading">
        <div className="relief-section-heading">
          <p className="relief-kicker">Committed record</p>
          <h2 id="relief-history-heading">Previous allocations</h2>
        </div>
        {details.previousAllocations.length > 0 ? (
          <div className="relief-history__list">
            {details.previousAllocations.map((allocation) => (
              <article key={allocation.allocationId}>
                <div>
                  <strong>{formatDateTime(allocation.createdAt)}</strong>
                  <span>Allocation …{allocation.allocationId.slice(-8)}</span>
                </div>
                <ul>
                  {allocation.items.map((item) => (
                    <li key={item.requestItemId}>
                      {formatSupplyType(item.supplyType)}: {item.allocatedQty} units
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="relief-empty-copy">No previous warehouse allocation has been committed.</p>
        )}
      </section>
    </section>
  );
}

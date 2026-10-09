import { ZoneSeverity } from "@disaster/domain";
import type { ReliefRequestDetails } from "@disaster/shared-types";

import {
  draftQuantity,
  formatSupplyType,
  humanizeConstant,
  itemMaximum,
  previewShortage,
  type AllocationDraft,
  type DraftValidation,
} from "./relief-ui";

interface ReliefAllocationPanelProps {
  readonly details: ReliefRequestDetails;
  readonly draft: AllocationDraft;
  readonly validation: DraftValidation | null;
  readonly showValidation: boolean;
  readonly hasPositiveAllocation: boolean;
  readonly updateDraft: (next: AllocationDraft) => void;
  readonly reviewAllocation: () => void;
}

export function ReliefAllocationPanel({
  details,
  draft,
  validation,
  showValidation,
  hasPositiveAllocation,
  updateDraft,
  reviewAllocation,
}: ReliefAllocationPanelProps) {
  const outstandingItems = details.items.filter(({ outstandingQty }) => outstandingQty > 0);
  const isResupplyOnly =
    outstandingItems.length > 0 &&
    outstandingItems.every((item) => (draftQuantity(draft, item.requestItemId) ?? 0) === 0);
  const rescueEligible =
    details.targetZone.severity === ZoneSeverity.CRITICAL && hasPositiveAllocation;

  return (
    <aside className="relief-allocation-panel" aria-labelledby="relief-allocation-heading">
      <div className="relief-allocation-panel__header">
        <div>
          <p className="relief-kicker">District Officer action</p>
          <h2 id="relief-allocation-heading">Prepare allocation</h2>
        </div>
        <span className="relief-ready-badge">Review required</span>
      </div>

      <dl className="relief-allocation-panel__context">
        <div>
          <dt>Target zone</dt>
          <dd>{details.targetZone.name}</dd>
        </div>
        <div>
          <dt>Request state</dt>
          <dd>{humanizeConstant(details.status)}</dd>
        </div>
      </dl>

      <p className="relief-allocation-panel__notice">
        Stock is revalidated when the allocation is confirmed.
      </p>

      <section className="relief-allocation-panel__items" aria-label="Supply allocations">
        {outstandingItems.map((item) => {
          const inputId = `quantity-${item.requestItemId}`;
          const selectId = `partner-${item.requestItemId}`;
          const quantityError = showValidation
            ? validation?.quantityErrors[item.requestItemId]
            : undefined;
          const partnerError = showValidation
            ? validation?.partnerErrors[item.requestItemId]
            : undefined;
          const shortage = previewShortage(item, draft);

          return (
            <article className="relief-control" key={item.requestItemId}>
              <div className="relief-control__header">
                <h3>{formatSupplyType(item.supplyType)}</h3>
                <span>{shortage} units short</span>
              </div>
              <dl className="relief-control__metrics">
                <div>
                  <dt>Requested</dt>
                  <dd>{item.requestedQty}</dd>
                </div>
                <div>
                  <dt>Previous</dt>
                  <dd>{item.previouslyAllocatedQty}</dd>
                </div>
                <div>
                  <dt>Outstanding</dt>
                  <dd>{item.outstandingQty}</dd>
                </div>
                <div>
                  <dt>Available</dt>
                  <dd>{item.warehouseStock.availableQty}</dd>
                </div>
              </dl>

              <div className="relief-field">
                <label htmlFor={inputId}>Allocate {formatSupplyType(item.supplyType)} now</label>
                <input
                  id={inputId}
                  type="number"
                  min="0"
                  max={itemMaximum(item)}
                  step="1"
                  inputMode="numeric"
                  value={draft.quantities[item.requestItemId] ?? ""}
                  aria-invalid={Boolean(quantityError)}
                  aria-describedby={quantityError ? `${inputId}-error` : `${inputId}-help`}
                  onChange={(event) =>
                    updateDraft({
                      ...draft,
                      quantities: {
                        ...draft.quantities,
                        [item.requestItemId]: event.target.value,
                      },
                    })
                  }
                />
                <small id={`${inputId}-help`}>
                  Maximum {itemMaximum(item)} · {item.outstandingQty} outstanding − allocate now ={" "}
                  {shortage} shortage
                </small>
                {quantityError && (
                  <small id={`${inputId}-error`} className="relief-field__error">
                    {quantityError}
                  </small>
                )}
              </div>

              {shortage > 0 && (
                <div className="relief-field relief-field--partner">
                  <label htmlFor={selectId}>Resupply partner</label>
                  <select
                    id={selectId}
                    value={draft.partnerIds[item.requestItemId] ?? ""}
                    aria-invalid={Boolean(partnerError)}
                    aria-describedby={partnerError ? `${selectId}-error` : undefined}
                    onChange={(event) =>
                      updateDraft({
                        ...draft,
                        partnerIds: {
                          ...draft.partnerIds,
                          [item.requestItemId]: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="">Select an eligible partner</option>
                    {details.eligiblePartners.map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name} · {humanizeConstant(partner.type)}
                      </option>
                    ))}
                  </select>
                  {partnerError && (
                    <small id={`${selectId}-error`} className="relief-field__error">
                      {partnerError}
                    </small>
                  )}
                </div>
              )}
              {shortage === 0 && (
                <span className="relief-covered-label">Covered by warehouse allocation</span>
              )}
            </article>
          );
        })}
      </section>

      {isResupplyOnly && (
        <p className="relief-resupply-only" role="note">
          No warehouse stock will be allocated. Remaining demand will be requested from partner
          organisations.
        </p>
      )}

      {rescueEligible && (
        <section className="relief-rescue" aria-labelledby="relief-rescue-heading">
          <p className="relief-kicker">Optional critical-zone support</p>
          <h3 id="relief-rescue-heading">Dispatch rescue team</h3>
          <p>Dispatch is committed in the same allocation transaction.</p>
          {details.availableRescueTeams.length > 0 ? (
            <div className="relief-field">
              <label htmlFor="rescue-team">Available rescue team</label>
              <select
                id="rescue-team"
                value={draft.rescueTeamId}
                onChange={(event) => updateDraft({ ...draft, rescueTeamId: event.target.value })}
              >
                <option value="">Continue without rescue dispatch</option>
                {details.availableRescueTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="relief-empty-copy">No rescue team is currently available.</p>
          )}
        </section>
      )}

      <section className="relief-notes" aria-labelledby="relief-notes-heading">
        <div>
          <h3 id="relief-notes-heading">Allocation notes</h3>
          <span id="notes-count">{draft.notes.length}/500</span>
        </div>
        <label className="relief-sr-only" htmlFor="allocation-notes">
          Notes for this allocation
        </label>
        <textarea
          id="allocation-notes"
          maxLength={500}
          rows={4}
          value={draft.notes}
          aria-invalid={Boolean(showValidation && validation?.notesError)}
          aria-describedby="notes-help notes-count"
          placeholder="Optional operational context"
          onChange={(event) => updateDraft({ ...draft, notes: event.target.value })}
        />
        <small id="notes-help">Notes are optional and do not change allocation rules.</small>
        {showValidation && validation?.notesError && (
          <small className="relief-field__error">{validation.notesError}</small>
        )}
      </section>

      <footer className="relief-allocation-panel__actions">
        <p>No stock or team state changes until final confirmation.</p>
        <button className="relief-button relief-button--primary" onClick={reviewAllocation}>
          Review allocation
        </button>
      </footer>
    </aside>
  );
}

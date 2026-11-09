/**
 * Selection pricing: one place where an item plus its options becomes a price.
 *
 * Extracted from the quote service so the cart draft and the quote cannot
 * disagree about what a selection costs or why it is refused
 * (docs/SECURITY.md section 2). The quote service throws on a bad selection;
 * the cart also needs to *describe* a bad selection without failing a read, so
 * the evaluation is non-throwing and `assertSelection` adds the HTTP mapping.
 *
 * Error mapping, unchanged from the quote milestone: unknown item or option is
 * `422`, existing-but-unavailable is `409`, and a combination that cannot be
 * priced is `409` rather than clamped.
 */

import { ApiError } from '../../middleware/errors.js';
import type { MenuItemDoc } from '../../models/menu.js';
import { assertMinorUnits } from '../../models/money.js';
import type { MenuSnapshot } from '../menu/menuService.js';

/** What the caller asked for: IDs and nothing else. */
export interface Selection {
  readonly menuItemId: string;
  readonly optionIds: readonly string[];
}

/** Reason codes, mirrored by `CartLineIssue` in the shared contracts. */
export type SelectionIssueReason =
  | 'itemNotOnMenu'
  | 'itemUnavailable'
  | 'optionNotOnItem'
  | 'optionUnavailable'
  | 'notPriceable';

export interface SelectionIssue {
  readonly reason: SelectionIssueReason;
  readonly menuItemId: string;
  readonly optionId?: string;
}

export type SelectionEvaluation =
  | {
      readonly ok: true;
      readonly item: MenuItemDoc;
      /** Item price plus every selected option delta, for one unit. */
      readonly unitPriceMinor: number;
    }
  | { readonly ok: false; readonly issue: SelectionIssue };

/**
 * Prices one unit of a selection against the current menu snapshot.
 *
 * Returns an issue rather than throwing for every *selection* fault. A corrupt
 * stored price still throws `MoneyError`, because that is a data fault rather
 * than something the customer chose.
 */
export function evaluateSelection(
  snapshot: MenuSnapshot,
  selection: Selection,
): SelectionEvaluation {
  const item = snapshot.itemsById.get(selection.menuItemId);
  if (item === undefined) {
    return {
      ok: false,
      issue: { reason: 'itemNotOnMenu', menuItemId: selection.menuItemId },
    };
  }
  if (!item.active) {
    return {
      ok: false,
      issue: { reason: 'itemUnavailable', menuItemId: selection.menuItemId },
    };
  }

  const options = item.options ?? [];
  // A stored price that is not a usable integer amount is a data fault, not a
  // customer error, so it stays a loud `MoneyError` exactly as in the quote
  // milestone. Callers that must survive one broken row - the cart draft -
  // catch it themselves and degrade that single line.
  let unitPriceMinor = assertMinorUnits(
    item.priceMinor,
    `menuItem ${item.publicId} priceMinor`,
  );

  for (const optionId of selection.optionIds) {
    const option = options.find((candidate) => candidate.publicId === optionId);
    if (option === undefined) {
      return {
        ok: false,
        issue: { reason: 'optionNotOnItem', menuItemId: item.publicId, optionId },
      };
    }
    if (!option.active) {
      return {
        ok: false,
        issue: { reason: 'optionUnavailable', menuItemId: item.publicId, optionId },
      };
    }

    // A delta may be negative, so the running total is checked rather than
    // assumed: a misconfigured discount must not produce a negative price.
    const next = unitPriceMinor + option.priceDeltaMinor;
    if (!Number.isSafeInteger(next) || next < 0) {
      return {
        ok: false,
        issue: { reason: 'notPriceable', menuItemId: item.publicId, optionId },
      };
    }
    unitPriceMinor = next;
  }

  return { ok: true, item, unitPriceMinor };
}

/**
 * Client-safe message and status for each reason.
 *
 * The messages are the ones the quote milestone already returned, so no
 * documented error body changes.
 */
export function selectionError(issue: SelectionIssue): ApiError {
  const details = [
    issue.optionId === undefined
      ? { menuItemId: issue.menuItemId }
      : { menuItemId: issue.menuItemId, optionId: issue.optionId },
  ];

  switch (issue.reason) {
    case 'itemNotOnMenu':
      return ApiError.unprocessable('Selected item is not on this menu', details);
    case 'itemUnavailable':
      return ApiError.conflict('Selected item is unavailable', details);
    case 'optionNotOnItem':
      return ApiError.unprocessable(
        'Selected option does not exist for this item',
        details,
      );
    case 'optionUnavailable':
      return ApiError.conflict('Selected option is unavailable', details);
    case 'notPriceable':
      return ApiError.conflict('This combination cannot be priced', details);
  }
}

/** Evaluation for callers that must refuse a bad selection outright. */
export function assertSelection(
  snapshot: MenuSnapshot,
  selection: Selection,
): { readonly item: MenuItemDoc; readonly unitPriceMinor: number } {
  const evaluation = evaluateSelection(snapshot, selection);
  if (!evaluation.ok) throw selectionError(evaluation.issue);
  return { item: evaluation.item, unitPriceMinor: evaluation.unitPriceMinor };
}

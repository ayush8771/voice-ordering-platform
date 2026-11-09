/**
 * Which `409` from a cart route means "the draft moved under you". Pure, so the
 * rule is testable without a browser, like `confirmOutcome.ts`.
 *
 * The backend uses `409` for several unrelated refusals. Only a revision
 * mismatch carries `details: [{ revision }]` (docs/API.md, "concurrency and
 * If-Match"). The others - unavailable item or option, quantity cap, line cap,
 * PATCH collision, unavailable draft at quote - leave the draft unchanged, and
 * some share one `details` shape (`[{ menuItemId, lineId }]` for both the
 * quantity cap and a collision), so they are deliberately not told apart here.
 *
 *  - `revision`: re-read the draft; it really did change.
 *  - `other`: refused; the draft is as the customer last saw it.
 */
export type CartConflict = 'revision' | 'other';

export function classifyCartConflict(
  details: readonly unknown[] | undefined,
): CartConflict {
  const first = details?.[0];
  if (typeof first !== 'object' || first === null) return 'other';
  const revision = (first as { revision?: unknown }).revision;
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0
    ? 'revision'
    : 'other';
}

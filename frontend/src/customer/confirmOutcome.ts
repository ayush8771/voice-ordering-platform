/**
 * How the client treats a failed `POST /api/v1/orders`. Pure, so the rule that
 * protects against duplicate orders is testable without a browser.
 *
 *  - `sessionLost`: 401. The ordering session is gone.
 *  - `staleQuote`: 409/422. The server refused the quote (expired, menu or
 *    price change, unavailable line). An earlier order under the same key
 *    and payload would have been replayed rather than refused, so no order
 *    exists and a fresh key is safe after re-quoting.
 *  - `refused`: any other 4xx. Rejected before creation; nothing exists.
 *  - `unknown`: network failure (status 0) or 5xx. The order may or may not
 *    exist, so the retry must reuse the same key and the same payload.
 */
export type ConfirmFailure = 'sessionLost' | 'staleQuote' | 'refused' | 'unknown';

export function classifyConfirmFailure(status: number, code: string): ConfirmFailure {
  if (code === 'UNAUTHORIZED' || status === 401) return 'sessionLost';
  if (status === 409 || status === 422) return 'staleQuote';
  if (status >= 400 && status < 500) return 'refused';
  return 'unknown';
}

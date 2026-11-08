/**
 * Issued quotes, kept so a later confirmation can be checked against what the
 * customer actually saw.
 *
 * In memory and bounded, like ordering sessions: whether drafts need
 * server-side persistence is undecided (docs/DATABASE.md section 2), so
 * nothing is written to MongoDB yet. Order creation is not in this milestone;
 * this exists so `expiresAt` means something and so the next milestone has a
 * quote to re-validate rather than trusting a client-supplied total.
 *
 * Each entry is bound to the session that requested it, so one session can
 * never redeem another session's quote (docs/SECURITY.md section 1).
 */

import type { QuoteResponse } from '@vop/shared';

export interface StoredQuote {
  readonly quote: QuoteResponse;
  readonly sessionId: string;
  readonly expiresAtMs: number;
}

export interface QuoteStore {
  put(quote: QuoteResponse, sessionId: string): void;
  /** Returns the quote only for the owning session, and only while unexpired. */
  get(quoteId: string, sessionId: string): StoredQuote | undefined;
  size(): number;
}

export const DEFAULT_MAX_QUOTES = 5000;

export function createQuoteStore(
  maxQuotes = DEFAULT_MAX_QUOTES,
  now: () => number = Date.now,
): QuoteStore {
  const quotes = new Map<string, StoredQuote>();

  function prune(): void {
    const current = now();
    for (const [quoteId, stored] of quotes) {
      if (stored.expiresAtMs <= current) quotes.delete(quoteId);
    }
  }

  return {
    put(quote, sessionId) {
      prune();
      // Oldest-first eviction only after pruning, so a full store sheds the
      // least recently issued quote rather than refusing to quote at all.
      if (quotes.size >= maxQuotes) {
        const oldest = quotes.keys().next();
        if (oldest.done !== true) quotes.delete(oldest.value);
      }
      quotes.set(quote.quoteId, {
        quote,
        sessionId,
        expiresAtMs: Date.parse(quote.expiresAt),
      });
    },

    get(quoteId, sessionId) {
      const stored = quotes.get(quoteId);
      if (stored === undefined) return undefined;
      if (stored.expiresAtMs <= now()) {
        quotes.delete(quoteId);
        return undefined;
      }
      // Wrong owner is reported as absent, not as forbidden, so a caller
      // cannot probe for another session's quote IDs.
      if (stored.sessionId !== sessionId) return undefined;
      return stored;
    },

    size() {
      prune();
      return quotes.size;
    },
  };
}

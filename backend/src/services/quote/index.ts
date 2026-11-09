/** Public surface of the quote service. */

export {
  assertSelection,
  evaluateSelection,
  selectionError,
  type Selection,
  type SelectionEvaluation,
  type SelectionIssue,
  type SelectionIssueReason,
} from './pricing.js';
export {
  createQuoteService,
  QUOTE_TTL_MS,
  type QuoteService,
  type QuoteServiceDeps,
  type QuoteSessionScope,
} from './quoteService.js';
export {
  createQuoteStore,
  DEFAULT_MAX_QUOTES,
  type QuoteStore,
  type StoredQuote,
} from './quoteStore.js';

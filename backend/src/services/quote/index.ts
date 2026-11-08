/** Public surface of the quote service. */

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

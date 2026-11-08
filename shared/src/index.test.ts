import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  ERROR_CODES,
  LANGUAGES,
  MAX_LINE_QUANTITY,
  MAX_QUOTE_LINES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from './index.js';
import * as contracts from './index.js';

/**
 * These assertions pin shared contract vocabulary. Both the backend and the
 * clients depend on these exact values, so a change here is a reviewed
 * contract change (docs/ARCHITECTURE.md section 6) rather than a refactor.
 */
describe('language contract', () => {
  it('exposes exactly the three confirmed Gnani languages', () => {
    expect(LANGUAGES).toEqual(['en', 'kn', 'hi']);
  });

  it('does not expose a code-switching pseudo-language', () => {
    // Hindi-English and Kannada-English code-switching are capabilities to
    // evaluate, not confirmed features, and never a language identifier.
    expect(LANGUAGES).not.toContain('hi-en');
    expect(LANGUAGES).not.toContain('kn-en');
    expect(LANGUAGES.some((code) => code.includes('-'))).toBe(false);
  });
});

describe('order and payment vocabulary', () => {
  it('keeps payment status independent of order status', () => {
    const overlap = PAYMENT_STATUSES.filter((status) =>
      (ORDER_STATUSES as readonly string[]).includes(status),
    );
    expect(overlap).toEqual([]);
  });

  it('offers only the two MVP payment methods', () => {
    expect(PAYMENT_METHODS).toEqual(['upiQr', 'cashAtCounter']);
  });

  it('supports both ordering channels', () => {
    expect(CHANNELS).toEqual(['qr', 'kiosk']);
  });

  it('exposes no error code implying verified payment', () => {
    expect(ERROR_CODES).not.toContain('PAYMENT_VERIFIED');
  });
});

describe('menu and quote contract vocabulary', () => {
  it('pins the quote request bounds both sides validate against', () => {
    expect(MAX_QUOTE_LINES).toBe(30);
    expect(MAX_LINE_QUANTITY).toBe(20);
  });

  it('keeps order and payment request shapes out of the contract for now', () => {
    // Order creation and payment are not implemented; adding their shapes is a
    // reviewed contract change, not an incidental export.
    const exported = Object.keys(contracts);
    expect(exported).not.toContain('CreateOrderRequest');
    expect(exported).not.toContain('PaymentWebhookPayload');
  });
});

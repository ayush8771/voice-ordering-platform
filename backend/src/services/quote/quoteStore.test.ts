import { describe, expect, it } from 'vitest';
import type { QuoteResponse } from '@vop/shared';
import { createQuoteStore } from './quoteStore.js';

const BASE_MS = 1_700_000_000_000;

function quote(quoteId: string, expiresAtMs = BASE_MS + 60_000): QuoteResponse {
  return {
    quoteId,
    outletId: 'demo-outlet',
    menuVersion: 'v1',
    items: [],
    subtotalMinor: 0,
    totalMinor: 0,
    currency: 'INR',
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

describe('quote store', () => {
  it('returns a quote to its owning session', () => {
    const store = createQuoteStore(10, () => BASE_MS);
    store.put(quote('q1'), 'sess_a');

    expect(store.get('q1', 'sess_a')?.sessionId).toBe('sess_a');
  });

  it('hides a quote from another session', () => {
    const store = createQuoteStore(10, () => BASE_MS);
    store.put(quote('q1'), 'sess_a');

    // Reported as absent, not forbidden, so IDs cannot be probed.
    expect(store.get('q1', 'sess_b')).toBeUndefined();
  });

  it('drops an expired quote', () => {
    const clock = { value: BASE_MS };
    const store = createQuoteStore(10, () => clock.value);
    store.put(quote('q1', BASE_MS + 1000), 'sess_a');

    clock.value = BASE_MS + 1001;
    expect(store.get('q1', 'sess_a')).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('evicts the oldest entry when full', () => {
    const store = createQuoteStore(2, () => BASE_MS);
    store.put(quote('q1'), 'sess_a');
    store.put(quote('q2'), 'sess_a');
    store.put(quote('q3'), 'sess_a');

    expect(store.get('q1', 'sess_a')).toBeUndefined();
    expect(store.get('q2', 'sess_a')).toBeDefined();
    expect(store.get('q3', 'sess_a')).toBeDefined();
  });

  it('returns undefined for an unknown quote', () => {
    const store = createQuoteStore(10, () => BASE_MS);
    expect(store.get('nope', 'sess_a')).toBeUndefined();
  });
});

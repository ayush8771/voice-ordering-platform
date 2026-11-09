import { describe, expect, it } from 'vitest';
import { CART_LINE_ISSUES, type CartResponse } from '@vop/shared';
import { cartIssueMessage, checkoutBlockedReason, formatMoney } from './cartRules';

function cart(overrides: Partial<CartResponse>): CartResponse {
  return {
    cartId: 'cart-1',
    outletId: 'demo-outlet',
    menuVersion: 'v1',
    revision: 1,
    items: [],
    subtotalMinor: 0,
    totalMinor: 0,
    currency: 'INR',
    hasUnavailableItems: false,
    updatedAt: '2026-11-09T00:00:00.000Z',
    ...overrides,
  };
}

const line = {
  lineId: 'line-1',
  menuItemId: 'item-1',
  name: 'Masala Dosa',
  quantity: 1,
  optionIds: [],
  unitPriceMinor: 8000,
  lineTotalMinor: 8000,
  available: true,
  issues: [],
} as const;

describe('checkoutBlockedReason', () => {
  it('blocks an empty or missing draft', () => {
    expect(checkoutBlockedReason(undefined)).toMatch(/add something/i);
    expect(checkoutBlockedReason(cart({}))).toMatch(/add something/i);
  });

  it('blocks while any line is unavailable, and says why', () => {
    const blocked = checkoutBlockedReason(
      cart({
        items: [
          line,
          { ...line, lineId: 'line-2', available: false, issues: ['itemUnavailable'] },
        ],
        hasUnavailableItems: true,
      }),
    );

    expect(blocked).toMatch(/unavailable/i);
  });

  it('allows review once every line is orderable', () => {
    expect(
      checkoutBlockedReason(
        cart({ items: [line], subtotalMinor: 8000, totalMinor: 8000 }),
      ),
    ).toBeUndefined();
  });
});

describe('cartIssueMessage', () => {
  it('has plain language for every issue the server can return', () => {
    for (const issue of CART_LINE_ISSUES) {
      expect(cartIssueMessage(issue)).toMatch(/\w/);
    }
  });
});

describe('formatMoney', () => {
  it('renders server minor units without rounding them away', () => {
    expect(formatMoney(8050, 'INR')).toContain('80.50');
    expect(formatMoney(0, 'INR')).toContain('0.00');
  });
});

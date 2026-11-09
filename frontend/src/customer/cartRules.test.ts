import { describe, expect, it } from 'vitest';
import {
  CART_LINE_ISSUES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type CartResponse,
  type MenuResponse,
} from '@vop/shared';
import {
  cartIssueMessage,
  checkoutBlockedReason,
  describeOptions,
  formatMoney,
  formatUpdatedTime,
  orderStatusLabel,
  paymentStatusLabel,
  resolveOptionLabels,
} from './cartRules';

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
  displayName: 'Masala Dosa',
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

const menu = {
  items: [
    {
      id: 'item-1',
      name: 'Masala Dosa',
      priceMinor: 8000,
      currency: 'INR',
      available: true,
      options: [
        { id: 'opt-ghee', label: 'Extra ghee', priceDeltaMinor: 1500 },
        { id: 'opt-onion', label: 'No onion', priceDeltaMinor: 0 },
      ],
    },
    {
      id: 'item-2',
      name: 'Filter Coffee',
      priceMinor: 3000,
      currency: 'INR',
      available: true,
      options: [{ id: 'opt-ghee', label: 'Strong', priceDeltaMinor: 0 }],
    },
  ],
} as unknown as MenuResponse;

describe('resolveOptionLabels', () => {
  it('names add-ons in the order the line lists them', () => {
    expect(resolveOptionLabels(menu, 'item-1', ['opt-onion', 'opt-ghee'])).toEqual([
      'No onion',
      'Extra ghee',
    ]);
  });

  it('resolves an option ID within its own item only', () => {
    expect(resolveOptionLabels(menu, 'item-2', ['opt-ghee'])).toEqual(['Strong']);
  });

  it('falls back to a generic name for unknown options, items or a missing menu', () => {
    expect(resolveOptionLabels(menu, 'item-1', ['opt-gone'])).toEqual(['Add-on']);
    expect(resolveOptionLabels(menu, 'item-gone', ['opt-ghee'])).toEqual(['Add-on']);
    expect(resolveOptionLabels(undefined, 'item-1', ['opt-ghee'])).toEqual(['Add-on']);
  });
});

describe('describeOptions', () => {
  it('is undefined for a line with no add-ons', () => {
    expect(describeOptions(menu, 'item-1', [])).toBeUndefined();
  });

  it('joins add-on names for display', () => {
    expect(describeOptions(menu, 'item-1', ['opt-ghee', 'opt-onion'])).toBe(
      'Extra ghee, No onion',
    );
  });
});

describe('status labels', () => {
  it('has customer wording for every known status, never the raw code', () => {
    for (const status of ORDER_STATUSES) {
      expect(orderStatusLabel(status)).not.toBe(status);
    }
    for (const status of PAYMENT_STATUSES) {
      expect(paymentStatusLabel(status)).not.toBe(status);
    }
    expect(orderStatusLabel('ready')).toMatch(/ready/i);
    expect(paymentStatusLabel('dueAtCounter')).toMatch(/counter/i);
  });

  it('falls back safely for unknown values', () => {
    expect(orderStatusLabel('somethingNew')).toMatch(/counter/i);
    expect(orderStatusLabel('toString')).toMatch(/counter/i);
    const unknownPayment = paymentStatusLabel('somethingNew');
    expect(unknownPayment).toMatch(/unknown/i);
    expect(unknownPayment).not.toMatch(/confirmed|paid/i);
  });
});

describe('formatUpdatedTime', () => {
  it('renders hours and minutes', () => {
    expect(formatUpdatedTime(new Date(2026, 10, 9, 14, 5))).toMatch(/2:05/);
  });
});

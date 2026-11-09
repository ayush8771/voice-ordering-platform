import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '@vop/shared';
import { DEMO_ORDERS } from './demoOrders';
import {
  ORDER_STATUS_STAFF_LABELS,
  PAYMENT_STATUS_STAFF_LABELS,
  countByStatus,
  filterOrders,
  readMerchantPage,
  summarise,
} from './merchantRules';

describe('readMerchantPage', () => {
  it('maps hash sub-paths and ignores the query string', () => {
    expect(readMerchantPage('#/merchant')).toBe('overview');
    expect(readMerchantPage('#/merchant/orders')).toBe('orders');
    expect(readMerchantPage('#/merchant/menu?outlet=demo-outlet')).toBe('menu');
    expect(readMerchantPage('#/merchant?outlet=x')).toBe('overview');
  });
});

describe('labels', () => {
  it('covers every status the shared contract defines', () => {
    for (const s of ORDER_STATUSES) expect(ORDER_STATUS_STAFF_LABELS[s]).toBeTruthy();
    for (const s of PAYMENT_STATUSES)
      expect(PAYMENT_STATUS_STAFF_LABELS[s]).toBeTruthy();
  });
});

describe('order rules', () => {
  it('filters by status, newest first', () => {
    const preparing = filterOrders(DEMO_ORDERS, 'preparing');
    expect(preparing.every((o) => o.orderStatus === 'preparing')).toBe(true);
    const all = filterOrders(DEMO_ORDERS, 'all');
    expect(all).toHaveLength(DEMO_ORDERS.length);
    expect(all[0]!.createdAt >= all[1]!.createdAt).toBe(true);
  });

  it('summarises pending, completed and non-cancelled revenue', () => {
    const counts = countByStatus(DEMO_ORDERS);
    const summary = summarise(DEMO_ORDERS);
    expect(summary.pending).toBe(counts.accepted + counts.preparing + counts.ready);
    expect(summary.completed).toBe(counts.collected);
    const cancelledTotal = DEMO_ORDERS.filter(
      (o) => o.orderStatus === 'cancelled',
    ).reduce((s, o) => s + o.totalMinor, 0);
    const allTotal = DEMO_ORDERS.reduce((s, o) => s + o.totalMinor, 0);
    expect(summary.revenueMinor).toBe(allTotal - cancelledTotal);
  });

  it('handles no orders', () => {
    expect(summarise([])).toEqual({
      total: 0,
      pending: 0,
      completed: 0,
      revenueMinor: 0,
    });
  });
});

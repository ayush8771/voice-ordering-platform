import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type OrderResponse,
} from '@vop/shared';
import {
  PAYMENT_METHOD_COPY,
  PAYMENT_VIEWS,
  PAYMENT_VIEW_KINDS,
  UPI_ONLINE_PAYMENT_AVAILABLE,
  paymentViewForOrder,
} from './paymentRules';

type Fields = Pick<OrderResponse, 'orderStatus' | 'paymentStatus' | 'paymentMethod'>;

const order = (partial: Partial<Fields>): Fields => ({
  orderStatus: 'accepted',
  paymentStatus: 'dueAtCounter',
  paymentMethod: 'cashAtCounter',
  ...partial,
});

describe('paymentViewForOrder', () => {
  it('reads as paid only for a server-verified payment', () => {
    for (const orderStatus of ORDER_STATUSES) {
      for (const paymentStatus of PAYMENT_STATUSES) {
        for (const paymentMethod of PAYMENT_METHODS) {
          const view = paymentViewForOrder({
            orderStatus,
            paymentStatus,
            paymentMethod,
          });
          expect(view.kind === 'successful').toBe(paymentStatus === 'verified');
        }
      }
    }
  });

  it('keeps cash orders due at the counter', () => {
    expect(paymentViewForOrder(order({})).kind).toBe('dueAtCounter');
  });

  it('shows a pending UPI order as awaiting counter confirmation', () => {
    const view = paymentViewForOrder(
      order({ paymentMethod: 'upiQr', paymentStatus: 'pending' }),
    );
    expect(view.kind).toBe(UPI_ONLINE_PAYMENT_AVAILABLE ? 'pending' : 'awaitingUpi');
    expect(view.body).not.toMatch(/\bpaid\b|confirmed your payment/i);
  });

  it('maps failed and refunded payments', () => {
    expect(paymentViewForOrder(order({ paymentStatus: 'failed' })).kind).toBe('failed');
    expect(paymentViewForOrder(order({ paymentStatus: 'refunded' })).kind).toBe(
      'refunded',
    );
  });

  it('headlines a cancelled order unless money was confirmed or refunded', () => {
    expect(paymentViewForOrder(order({ orderStatus: 'cancelled' })).kind).toBe(
      'orderCancelled',
    );
    expect(
      paymentViewForOrder(
        order({ orderStatus: 'cancelled', paymentStatus: 'refunded' }),
      ).kind,
    ).toBe('refunded');
  });

  it('never reads an unknown status as paid', () => {
    const view = paymentViewForOrder(
      order({ paymentStatus: 'somethingNew' as Fields['paymentStatus'] }),
    );
    expect(view.kind).toBe('unknown');
  });

  it('never returns a placeholder state from an order', () => {
    for (const orderStatus of ORDER_STATUSES) {
      for (const paymentStatus of PAYMENT_STATUSES) {
        for (const paymentMethod of PAYMENT_METHODS) {
          const view = paymentViewForOrder({
            orderStatus,
            paymentStatus,
            paymentMethod,
          });
          expect(view.source).toBe('server');
        }
      }
    }
  });
});

describe('payment copy', () => {
  it('defines a view for every kind, keyed consistently', () => {
    for (const kind of PAYMENT_VIEW_KINDS) {
      expect(PAYMENT_VIEWS[kind].kind).toBe(kind);
    }
  });

  it('marks unsupported states as placeholders', () => {
    expect(PAYMENT_VIEWS.verifying.source).toBe('placeholder');
    expect(PAYMENT_VIEWS.paymentCancelled.source).toBe('placeholder');
  });

  it('describes every payment method without inventing a UPI ID or link', () => {
    for (const method of PAYMENT_METHODS) {
      const copy = PAYMENT_METHOD_COPY[method];
      expect(copy.steps.length).toBeGreaterThan(0);
      expect([copy.summary, ...copy.steps].join(' ')).not.toMatch(
        /@|upi:\/\/|https?:/i,
      );
    }
  });
});

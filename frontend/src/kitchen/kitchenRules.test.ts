import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderResponse } from '@vop/shared';
import { DEMO_ORDERS } from '../merchant/demoOrders';
import {
  AGE_LATE_MINUTES,
  AGE_WATCH_MINUTES,
  KITCHEN_STATUS_LABELS,
  addOnLabel,
  ageLevel,
  buildBoard,
  columnForStatus,
  elapsedMinutes,
  formatElapsed,
  isKitchenHash,
} from './kitchenRules';

describe('columnForStatus', () => {
  it('maps the three working statuses one-to-one and hides the rest', () => {
    expect(columnForStatus('accepted')).toBe('new');
    expect(columnForStatus('preparing')).toBe('preparing');
    expect(columnForStatus('ready')).toBe('ready');
    expect(columnForStatus('collected')).toBeUndefined();
    expect(columnForStatus('cancelled')).toBeUndefined();
  });

  it('has a kitchen label for every shared status', () => {
    for (const status of ORDER_STATUSES) {
      expect(KITCHEN_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});

describe('buildBoard', () => {
  it('places demo orders by status, oldest first, and counts hidden ones', () => {
    const board = buildBoard(DEMO_ORDERS, 'demo-outlet');
    expect(board.columns.new.map((o) => o.token)).toEqual(['11', '12']);
    expect(board.columns.preparing.map((o) => o.token)).toEqual(['9', '10']);
    expect(board.columns.ready.map((o) => o.token)).toEqual(['8']);
    expect(board.hiddenCount).toBe(3);
  });

  it('never shows another outlet’s orders', () => {
    const board = buildBoard(DEMO_ORDERS, 'other-outlet');
    expect(board.columns.new).toHaveLength(0);
    expect(board.columns.preparing).toHaveLength(0);
    expect(board.columns.ready).toHaveLength(0);
    expect(board.hiddenCount).toBe(0);
  });

  it('does not mutate its input', () => {
    const input: OrderResponse[] = [...DEMO_ORDERS];
    const before = input.map((o) => o.orderId);
    buildBoard(input, 'demo-outlet');
    expect(input.map((o) => o.orderId)).toEqual(before);
  });
});

describe('ageing', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');

  it('computes whole elapsed minutes and never goes negative', () => {
    expect(elapsedMinutes('2026-11-09T11:50:30Z', now)).toBe(9);
    expect(elapsedMinutes('2026-11-09T12:05:00Z', now)).toBe(0);
    expect(elapsedMinutes('not a date', now)).toBe(0);
  });

  it('escalates only orders the kitchen still owes', () => {
    expect(ageLevel(AGE_WATCH_MINUTES - 1, 'accepted')).toBe('normal');
    expect(ageLevel(AGE_WATCH_MINUTES, 'accepted')).toBe('watch');
    expect(ageLevel(AGE_LATE_MINUTES, 'preparing')).toBe('late');
    expect(ageLevel(AGE_LATE_MINUTES + 30, 'ready')).toBe('normal');
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('Just now');
    expect(formatElapsed(7)).toBe('7 min');
    expect(formatElapsed(65)).toBe('1 h 05 min');
  });
});

describe('helpers', () => {
  it('labels add-on counts', () => {
    expect(addOnLabel(0)).toBeUndefined();
    expect(addOnLabel(1)).toBe('+1 add-on');
    expect(addOnLabel(3)).toBe('+3 add-ons');
  });

  it('recognises the kitchen route', () => {
    expect(isKitchenHash('#/kitchen')).toBe(true);
    expect(isKitchenHash('#/kitchen?outlet=demo-outlet')).toBe(true);
    expect(isKitchenHash('#/kitchenette')).toBe(false);
    expect(isKitchenHash('#/merchant')).toBe(false);
  });
});

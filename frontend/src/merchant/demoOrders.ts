import type { OrderResponse } from '@vop/shared';

/**
 * SAMPLE DATA ONLY. No merchant order-listing API exists yet, and staff
 * authentication is an open decision (docs/PRD.md section 9), so the
 * dashboard and orders page render these fixtures and say so on screen.
 *
 * Shapes follow the shared `OrderResponse` contract exactly, so swapping in a
 * real API later changes the data source, not the components. Values are
 * invented and must never be presented as live outlet data.
 *
 * Times are generated relative to "now" so the sample reads as "today".
 */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function order(
  n: number,
  partial: Pick<
    OrderResponse,
    'channel' | 'orderStatus' | 'paymentMethod' | 'paymentStatus' | 'items'
  > & { readonly age: number },
): OrderResponse {
  const total = partial.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  return {
    orderId: `demo-order-${n}`,
    token: String(n),
    outletId: 'demo-outlet',
    channel: partial.channel,
    orderStatus: partial.orderStatus,
    paymentMethod: partial.paymentMethod,
    paymentStatus: partial.paymentStatus,
    items: partial.items,
    subtotalMinor: total,
    totalMinor: total,
    currency: 'INR',
    createdAt: minutesAgo(partial.age),
    updatedAt: minutesAgo(Math.max(0, partial.age - 2)),
  };
}

const dosa = (quantity: number, optionIds: readonly string[] = []) => ({
  menuItemId: 'demo-dosa',
  nameAtOrder: 'Masala Dosa',
  quantity,
  optionIds,
  unitPriceMinor: 8000,
  lineTotalMinor: 8000 * quantity,
});
const idli = (quantity: number) => ({
  menuItemId: 'demo-idli',
  nameAtOrder: 'Idli Vada',
  quantity,
  optionIds: [],
  unitPriceMinor: 6000,
  lineTotalMinor: 6000 * quantity,
});
const coffee = (quantity: number) => ({
  menuItemId: 'demo-coffee',
  nameAtOrder: 'Filter Coffee',
  quantity,
  optionIds: [],
  unitPriceMinor: 3000,
  lineTotalMinor: 3000 * quantity,
});

export const DEMO_ORDERS: readonly OrderResponse[] = [
  order(12, {
    channel: 'kiosk',
    orderStatus: 'accepted',
    paymentMethod: 'cashAtCounter',
    paymentStatus: 'dueAtCounter',
    items: [dosa(2, ['demo-extra-chutney']), coffee(2)],
    age: 2,
  }),
  order(11, {
    channel: 'qr',
    orderStatus: 'accepted',
    paymentMethod: 'upiQr',
    paymentStatus: 'pending',
    items: [idli(1)],
    age: 5,
  }),
  order(10, {
    channel: 'qr',
    orderStatus: 'preparing',
    paymentMethod: 'upiQr',
    paymentStatus: 'verified',
    items: [dosa(1), idli(1), coffee(1)],
    age: 9,
  }),
  order(9, {
    channel: 'kiosk',
    orderStatus: 'preparing',
    paymentMethod: 'cashAtCounter',
    paymentStatus: 'verified',
    items: [coffee(3)],
    age: 14,
  }),
  order(8, {
    channel: 'qr',
    orderStatus: 'ready',
    paymentMethod: 'cashAtCounter',
    paymentStatus: 'dueAtCounter',
    items: [dosa(1)],
    age: 21,
  }),
  order(7, {
    channel: 'kiosk',
    orderStatus: 'collected',
    paymentMethod: 'upiQr',
    paymentStatus: 'verified',
    items: [dosa(2), idli(2)],
    age: 40,
  }),
  order(6, {
    channel: 'qr',
    orderStatus: 'collected',
    paymentMethod: 'cashAtCounter',
    paymentStatus: 'verified',
    items: [idli(1), coffee(1)],
    age: 58,
  }),
  order(5, {
    channel: 'qr',
    orderStatus: 'cancelled',
    paymentMethod: 'upiQr',
    paymentStatus: 'failed',
    items: [coffee(1)],
    age: 75,
  }),
];

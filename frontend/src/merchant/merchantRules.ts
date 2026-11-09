import type { OrderResponse, OrderStatus, PaymentStatus } from '@vop/shared';

/**
 * Display rules for the merchant dashboard. Pure functions over orders the
 * dashboard was given; they never change a status and invent no transition.
 */

export type MerchantPage = 'overview' | 'orders' | 'menu';

/** `#/merchant`, `#/merchant/orders`, `#/merchant/menu` (query string ignored). */
export function readMerchantPage(hash: string): MerchantPage {
  const path = hash.split('?')[0] ?? '';
  if (path.startsWith('#/merchant/orders')) return 'orders';
  if (path.startsWith('#/merchant/menu')) return 'menu';
  return 'overview';
}

/** Staff-facing wording, distinct from the customer wording in cartRules. */
export const ORDER_STATUS_STAFF_LABELS: Record<OrderStatus, string> = {
  accepted: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  collected: 'Completed',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_STAFF_LABELS: Record<PaymentStatus, string> = {
  pending: 'Awaiting UPI',
  dueAtCounter: 'Due at counter',
  verified: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
};

/** Filter chips: "All" plus every status the shared contract defines. */
export type OrderFilter = 'all' | OrderStatus;

export function filterOrders(
  orders: readonly OrderResponse[],
  filter: OrderFilter,
): OrderResponse[] {
  const matching =
    filter === 'all' ? [...orders] : orders.filter((o) => o.orderStatus === filter);
  return matching.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function countByStatus(
  orders: readonly OrderResponse[],
): Record<OrderStatus, number> {
  const counts: Record<OrderStatus, number> = {
    accepted: 0,
    preparing: 0,
    ready: 0,
    collected: 0,
    cancelled: 0,
  };
  for (const o of orders) counts[o.orderStatus] += 1;
  return counts;
}

export interface OverviewSummary {
  readonly total: number;
  /** Accepted, preparing or ready: still the kitchen's to finish. */
  readonly pending: number;
  readonly completed: number;
  /**
   * Sum of server-calculated order totals, excluding cancelled orders. A
   * display aggregate only; no price or total is recalculated here.
   */
  readonly revenueMinor: number;
}

export function summarise(orders: readonly OrderResponse[]): OverviewSummary {
  const counts = countByStatus(orders);
  return {
    total: orders.length,
    pending: counts.accepted + counts.preparing + counts.ready,
    completed: counts.collected,
    revenueMinor: orders
      .filter((o) => o.orderStatus !== 'cancelled')
      .reduce((sum, o) => sum + o.totalMinor, 0),
  };
}

export function portionCount(order: OrderResponse): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Local time like "2:05 pm" for an ISO timestamp. */
export function formatOrderTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

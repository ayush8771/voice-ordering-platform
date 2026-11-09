import type { OrderResponse, OrderStatus } from '@vop/shared';

/**
 * Display rules for the kitchen display (KDS). Pure functions over orders the
 * display was given: they never change a status and invent no transition.
 *
 * Column mapping (shared `ORDER_STATUSES` -> kitchen column):
 *
 *   accepted   -> New        accepted by the backend, not started yet
 *   preparing  -> Preparing
 *   ready      -> Ready      waiting for the customer to collect
 *   collected  -> (hidden)   finished; nothing left for the kitchen to do
 *   cancelled  -> (hidden)   must not be cooked; counted, never shown as work
 *
 * The mapping is one-to-one for the three working statuses, so no status is
 * merged or reinterpreted. `paymentStatus` is deliberately ignored for column
 * placement: kitchen and payment state are separate (docs/CODE_STYLE.md).
 */

export type KitchenColumnId = 'new' | 'preparing' | 'ready';

export interface KitchenColumnDef {
  readonly id: KitchenColumnId;
  readonly status: OrderStatus;
  readonly title: string;
  readonly description: string;
  /** Label of the next-step control. The action itself is not available yet. */
  readonly nextAction: string;
  readonly emptyText: string;
}

export const KITCHEN_COLUMNS: readonly KitchenColumnDef[] = [
  {
    id: 'new',
    status: 'accepted',
    title: 'New',
    description: 'Accepted, waiting to start',
    nextAction: 'Start preparing',
    emptyText: 'No new orders waiting.',
  },
  {
    id: 'preparing',
    status: 'preparing',
    title: 'Preparing',
    description: 'Being cooked now',
    nextAction: 'Mark ready',
    emptyText: 'Nothing is being prepared.',
  },
  {
    id: 'ready',
    status: 'ready',
    title: 'Ready',
    description: 'Waiting for pickup',
    nextAction: 'Mark collected',
    emptyText: 'No orders waiting for pickup.',
  },
];

/** Kitchen wording for every shared status, including the hidden ones. */
export const KITCHEN_STATUS_LABELS: Record<OrderStatus, string> = {
  accepted: 'New',
  preparing: 'Preparing',
  ready: 'Ready',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

export function columnForStatus(status: OrderStatus): KitchenColumnId | undefined {
  return KITCHEN_COLUMNS.find((c) => c.status === status)?.id;
}

export interface KitchenBoard {
  readonly columns: Record<KitchenColumnId, OrderResponse[]>;
  /** Collected or cancelled orders: in the data, but not kitchen work. */
  readonly hiddenCount: number;
}

/**
 * Splits orders into columns, oldest first within each column (first in,
 * first cooked). Only orders for `outletId` are considered, so a display can
 * never show another outlet's tickets.
 */
export function buildBoard(
  orders: readonly OrderResponse[],
  outletId: string,
): KitchenBoard {
  const columns: Record<KitchenColumnId, OrderResponse[]> = {
    new: [],
    preparing: [],
    ready: [],
  };
  let hiddenCount = 0;
  for (const o of orders) {
    if (o.outletId !== outletId) continue;
    const column = columnForStatus(o.orderStatus);
    if (column === undefined) hiddenCount += 1;
    else columns[column].push(o);
  }
  for (const list of Object.values(columns)) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return { columns, hiddenCount };
}

/**
 * PROVISIONAL thresholds, not a product decision: no preparation-time target
 * is documented. Ageing only applies while the kitchen still owes work (New
 * and Preparing); a Ready order is waiting on the customer, not the kitchen.
 */
export const AGE_WATCH_MINUTES = 8;
export const AGE_LATE_MINUTES = 15;

export type AgeLevel = 'normal' | 'watch' | 'late';

export function elapsedMinutes(createdAt: string, now: number): number {
  const ms = now - Date.parse(createdAt);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

export function ageLevel(minutes: number, status: OrderStatus): AgeLevel {
  if (status !== 'accepted' && status !== 'preparing') return 'normal';
  if (minutes >= AGE_LATE_MINUTES) return 'late';
  if (minutes >= AGE_WATCH_MINUTES) return 'watch';
  return 'normal';
}

/** "Just now", "7 min", "1 h 05 min". */
export function formatElapsed(minutes: number): string {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export function addOnLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return `+${count} ${count === 1 ? 'add-on' : 'add-ons'}`;
}

/** `#/kitchen`, `#/kitchen?outlet=x` (also tolerates a trailing slash). */
export function isKitchenHash(hash: string): boolean {
  const path = hash.split('?')[0] ?? '';
  return path === '#/kitchen' || path.startsWith('#/kitchen/');
}

import type { Language, OrderResponse, OrderStatus } from '@vop/shared';
import { translate, translatePlural } from '../i18n/translate';

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

/**
 * A kitchen column. Its title, description, next-step label and empty text are
 * the `k.col.<id>.*` dictionary entries, so they follow the UI language.
 */
export interface KitchenColumnDef {
  readonly id: KitchenColumnId;
  readonly status: OrderStatus;
}

export const KITCHEN_COLUMNS: readonly KitchenColumnDef[] = [
  { id: 'new', status: 'accepted' },
  { id: 'preparing', status: 'preparing' },
  { id: 'ready', status: 'ready' },
];

/** Kitchen wording for a shared status, including the hidden ones. */
export function kitchenStatusLabel(
  status: OrderStatus,
  language: Language = 'en',
): string {
  return translate(language, `k.status.${status}`);
}

/** English kitchen wording for every shared status. */
export const KITCHEN_STATUS_LABELS: Record<OrderStatus, string> = {
  accepted: kitchenStatusLabel('accepted'),
  preparing: kitchenStatusLabel('preparing'),
  ready: kitchenStatusLabel('ready'),
  collected: kitchenStatusLabel('collected'),
  cancelled: kitchenStatusLabel('cancelled'),
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
export function formatElapsed(minutes: number, language: Language = 'en'): string {
  if (minutes < 1) return translate(language, 'k.elapsed.now');
  if (minutes < 60) return translate(language, 'k.elapsed.minutes', { minutes });
  return translate(language, 'k.elapsed.hours', {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, '0'),
  });
}

export function addOnLabel(
  count: number,
  language: Language = 'en',
): string | undefined {
  if (count <= 0) return undefined;
  return translatePlural(language, 'k.addOns', count);
}

/** `#/kitchen`, `#/kitchen?outlet=x` (also tolerates a trailing slash). */
export function isKitchenHash(hash: string): boolean {
  const path = hash.split('?')[0] ?? '';
  return path === '#/kitchen' || path.startsWith('#/kitchen/');
}

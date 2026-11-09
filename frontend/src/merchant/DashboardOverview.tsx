import type { JSX } from 'react';
import { ORDER_STATUSES, type OrderResponse } from '@vop/shared';
import { formatMoney } from '../customer/cartRules';
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  StateMessage,
  SummaryCard,
} from './components';
import {
  ORDER_STATUS_STAFF_LABELS,
  countByStatus,
  filterOrders,
  formatOrderTime,
  portionCount,
  summarise,
} from './merchantRules';

export function DashboardOverview({
  orders,
  ordersHref,
}: {
  orders: readonly OrderResponse[];
  ordersHref: string;
}): JSX.Element {
  const summary = summarise(orders);
  const counts = countByStatus(orders);
  const recent = filterOrders(orders, 'all').slice(0, 5);
  const max = Math.max(1, ...Object.values(counts));

  return (
    <>
      <section aria-label="Today at a glance" className="vop-m-summaries">
        <SummaryCard label="Today's orders" value={String(summary.total)} />
        <SummaryCard
          label="In progress"
          value={String(summary.pending)}
          hint="Pending, preparing or ready"
        />
        <SummaryCard label="Completed" value={String(summary.completed)} />
        <SummaryCard
          label="Today's revenue"
          value={formatMoney(summary.revenueMinor, 'INR')}
          hint="Excludes cancelled orders"
        />
      </section>

      <div className="vop-m-columns">
        <section className="vop-m-card" aria-labelledby="vop-m-recent">
          <div className="vop-m-section-head">
            <h2 id="vop-m-recent">Recent orders</h2>
            <a className="vop-m-link" href={ordersHref}>
              View all orders
            </a>
          </div>
          {recent.length === 0 ? (
            <StateMessage title="No orders yet today">
              New orders will appear here.
            </StateMessage>
          ) : (
            <ul className="vop-m-recent">
              {recent.map((o) => (
                <li key={o.orderId}>
                  <span className="vop-m-token">#{o.token}</span>
                  <span className="vop-m-recent__meta">
                    {portionCount(o)} {portionCount(o) === 1 ? 'item' : 'items'} ·{' '}
                    {formatOrderTime(o.createdAt)}
                  </span>
                  <span className="vop-m-recent__badges">
                    <OrderStatusBadge status={o.orderStatus} />
                    <PaymentStatusBadge status={o.paymentStatus} />
                  </span>
                  <span className="vop-m-amount">
                    {formatMoney(o.totalMinor, o.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="vop-m-card" aria-labelledby="vop-m-status">
          <h2 id="vop-m-status">Order status</h2>
          <dl className="vop-m-bars">
            {ORDER_STATUSES.map((status) => (
              <div key={status} className="vop-m-bar">
                <dt>{ORDER_STATUS_STAFF_LABELS[status]}</dt>
                <dd>
                  <span
                    className={`vop-m-bar__fill vop-m-badge--${status}`}
                    style={{ width: `${(counts[status] / max) * 100}%` }}
                    aria-hidden="true"
                  />
                  <span className="vop-m-bar__value">{counts[status]}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}

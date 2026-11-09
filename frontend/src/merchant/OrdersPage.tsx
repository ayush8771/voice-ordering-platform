import { useState, type JSX } from 'react';
import { ORDER_STATUSES, type OrderResponse } from '@vop/shared';
import { formatMoney } from '../customer/cartRules';
import {
  ComingSoonButton,
  OrderStatusBadge,
  PaymentStatusBadge,
  StateMessage,
} from './components';
import {
  ORDER_STATUS_STAFF_LABELS,
  countByStatus,
  filterOrders,
  formatOrderTime,
  type OrderFilter,
} from './merchantRules';

const CHANNEL_LABELS = { qr: 'QR', kiosk: 'Kiosk' } as const;
const METHOD_LABELS = { upiQr: 'UPI QR', cashAtCounter: 'Cash' } as const;

export function OrdersPage({
  orders,
}: {
  orders: readonly OrderResponse[];
}): JSX.Element {
  const [filter, setFilter] = useState<OrderFilter>('all');
  const counts = countByStatus(orders);
  const visible = filterOrders(orders, filter);
  const filters: readonly OrderFilter[] = ['all', ...ORDER_STATUSES];

  return (
    <>
      <div className="vop-m-filters" role="group" aria-label="Filter by order status">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className="vop-m-chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : ORDER_STATUS_STAFF_LABELS[f]}
            <span className="vop-m-chip__count">
              {f === 'all' ? orders.length : counts[f]}
            </span>
          </button>
        ))}
      </div>

      <p className="vop-m-note">
        Status changes (start preparing, mark ready, collected) and payment confirmation
        need the merchant API and staff sign-in, so they are not available here yet.
      </p>

      {visible.length === 0 ? (
        <StateMessage
          title={
            filter === 'all'
              ? 'No orders yet'
              : `No ${ORDER_STATUS_STAFF_LABELS[filter].toLowerCase()} orders`
          }
          action={
            filter !== 'all' ? (
              <button
                type="button"
                className="vop-m-button"
                onClick={() => setFilter('all')}
              >
                Show all orders
              </button>
            ) : undefined
          }
        >
          {filter === 'all' ? 'New orders will appear here.' : 'Try another status.'}
        </StateMessage>
      ) : (
        <ul className="vop-m-orders">
          {visible.map((o) => (
            <li key={o.orderId} className="vop-m-card vop-m-order">
              <div className="vop-m-order__head">
                <div>
                  <p className="vop-m-token">Token #{o.token}</p>
                  <p className="vop-m-muted">
                    {o.orderId} · {CHANNEL_LABELS[o.channel]} ·{' '}
                    <time dateTime={o.createdAt}>{formatOrderTime(o.createdAt)}</time>
                  </p>
                </div>
                <p className="vop-m-amount">{formatMoney(o.totalMinor, o.currency)}</p>
              </div>

              <ul className="vop-m-order__items">
                {o.items.map((item, index) => (
                  <li key={`${item.menuItemId}-${index}`}>
                    <span>
                      {item.quantity} × {item.nameAtOrder}
                      {item.optionIds.length > 0 && (
                        <span className="vop-m-muted">
                          {' '}
                          (+{item.optionIds.length}{' '}
                          {item.optionIds.length === 1 ? 'add-on' : 'add-ons'})
                        </span>
                      )}
                    </span>
                    <span>{formatMoney(item.lineTotalMinor, o.currency)}</span>
                  </li>
                ))}
              </ul>

              <div className="vop-m-order__foot">
                <span className="vop-m-order__badges">
                  <span className="vop-m-muted">Order</span>
                  <OrderStatusBadge status={o.orderStatus} />
                  <span className="vop-m-muted">
                    Payment ({METHOD_LABELS[o.paymentMethod]})
                  </span>
                  <PaymentStatusBadge status={o.paymentStatus} />
                </span>
                <ComingSoonButton>Update status</ComingSoonButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

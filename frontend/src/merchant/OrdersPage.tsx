import { useState, type JSX } from 'react';
import { ORDER_STATUSES, type OrderResponse } from '@vop/shared';
import { formatMoney } from '../customer/cartRules';
import { useI18n } from '../i18n/I18nProvider';
import {
  ComingSoonButton,
  OrderStatusBadge,
  PaymentStatusBadge,
  StateMessage,
} from './components';
import {
  countByStatus,
  filterOrders,
  formatOrderTime,
  orderStatusStaffLabel,
  type OrderFilter,
} from './merchantRules';

export function OrdersPage({
  orders,
}: {
  orders: readonly OrderResponse[];
}): JSX.Element {
  const { t, tp, language } = useI18n();
  const [filter, setFilter] = useState<OrderFilter>('all');
  const counts = countByStatus(orders);
  const visible = filterOrders(orders, filter);
  const filters: readonly OrderFilter[] = ['all', ...ORDER_STATUSES];

  return (
    <>
      <div className="vop-m-filters" role="group" aria-label={t('m.filters.label')}>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className="vop-m-chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('m.filters.all') : orderStatusStaffLabel(f, language)}
            <span className="vop-m-chip__count">
              {f === 'all' ? orders.length : counts[f]}
            </span>
          </button>
        ))}
      </div>

      <p className="vop-m-note">{t('m.orders.note')}</p>

      {visible.length === 0 ? (
        <StateMessage
          title={
            filter === 'all'
              ? t('m.orders.emptyAll')
              : t('m.orders.emptyFiltered', {
                  status: orderStatusStaffLabel(filter, language).toLocaleLowerCase(),
                })
          }
          action={
            filter !== 'all' ? (
              <button
                type="button"
                className="vop-m-button"
                onClick={() => setFilter('all')}
              >
                {t('m.orders.showAll')}
              </button>
            ) : undefined
          }
        >
          {filter === 'all' ? t('m.orders.emptyAllBody') : t('m.orders.tryAnother')}
        </StateMessage>
      ) : (
        <ul className="vop-m-orders">
          {visible.map((o) => (
            <li key={o.orderId} className="vop-m-card vop-m-order">
              <div className="vop-m-order__head">
                <div>
                  <p className="vop-m-token">
                    {t('m.orders.token', { token: o.token })}
                  </p>
                  <p className="vop-m-muted">
                    {o.orderId} · {t(o.channel === 'qr' ? 'common.qr' : 'common.kiosk')}{' '}
                    ·{' '}
                    <time dateTime={o.createdAt}>
                      {formatOrderTime(o.createdAt, language)}
                    </time>
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
                          {tp('m.orders.addOns', item.optionIds.length)}
                        </span>
                      )}
                    </span>
                    <span>{formatMoney(item.lineTotalMinor, o.currency)}</span>
                  </li>
                ))}
              </ul>

              <div className="vop-m-order__foot">
                <span className="vop-m-order__badges">
                  <span className="vop-m-muted">{t('m.orders.order')}</span>
                  <OrderStatusBadge status={o.orderStatus} />
                  <span className="vop-m-muted">
                    {t('m.orders.payment', {
                      method: t(`m.method.${o.paymentMethod}`),
                    })}
                  </span>
                  <PaymentStatusBadge status={o.paymentStatus} />
                </span>
                <ComingSoonButton>{t('m.orders.updateStatus')}</ComingSoonButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

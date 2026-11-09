import type { JSX } from 'react';
import { ORDER_STATUSES, type OrderResponse } from '@vop/shared';
import { formatMoney } from '../customer/cartRules';
import { useI18n } from '../i18n/I18nProvider';
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  StateMessage,
  SummaryCard,
} from './components';
import {
  countByStatus,
  filterOrders,
  formatOrderTime,
  orderStatusStaffLabel,
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
  const { t, tp, language } = useI18n();
  const summary = summarise(orders);
  const counts = countByStatus(orders);
  const recent = filterOrders(orders, 'all').slice(0, 5);
  const max = Math.max(1, ...Object.values(counts));

  return (
    <>
      <section aria-label={t('m.summary.label')} className="vop-m-summaries">
        <SummaryCard label={t('m.summary.total')} value={String(summary.total)} />
        <SummaryCard
          label={t('m.summary.inProgress')}
          value={String(summary.pending)}
          hint={t('m.summary.inProgressHint')}
        />
        <SummaryCard
          label={t('m.summary.completed')}
          value={String(summary.completed)}
        />
        <SummaryCard
          label={t('m.summary.revenue')}
          value={formatMoney(summary.revenueMinor, 'INR')}
          hint={t('m.summary.revenueHint')}
        />
      </section>

      <div className="vop-m-columns">
        <section className="vop-m-card" aria-labelledby="vop-m-recent">
          <div className="vop-m-section-head">
            <h2 id="vop-m-recent">{t('m.recent.heading')}</h2>
            <a className="vop-m-link" href={ordersHref}>
              {t('m.recent.viewAll')}
            </a>
          </div>
          {recent.length === 0 ? (
            <StateMessage title={t('m.recent.emptyTitle')}>
              {t('m.recent.emptyBody')}
            </StateMessage>
          ) : (
            <ul className="vop-m-recent">
              {recent.map((o) => (
                <li key={o.orderId}>
                  <span className="vop-m-token">#{o.token}</span>
                  <span className="vop-m-recent__meta">
                    {tp('m.items', portionCount(o))} ·{' '}
                    {formatOrderTime(o.createdAt, language)}
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
          <h2 id="vop-m-status">{t('m.statusChart')}</h2>
          <dl className="vop-m-bars">
            {ORDER_STATUSES.map((status) => (
              <div key={status} className="vop-m-bar">
                <dt>{orderStatusStaffLabel(status, language)}</dt>
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

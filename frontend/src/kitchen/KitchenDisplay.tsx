import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import type { OrderResponse } from '@vop/shared';
import { getHealth } from '../api/client';
import { DEMO_ORDERS } from '../merchant/demoOrders';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageSelect } from '../i18n/LanguagePicker';
import { formatOrderTime, paymentStatusStaffLabel } from '../merchant/merchantRules';
import {
  KITCHEN_COLUMNS,
  addOnLabel,
  ageLevel,
  buildBoard,
  elapsedMinutes,
  formatElapsed,
  kitchenStatusLabel,
  type KitchenBoard,
  type KitchenColumnDef,
} from './kitchenRules';
import './kitchen.css';

/**
 * Kitchen display (KDS): a tablet-first, three-column ticket board.
 *
 * Neither a kitchen order feed nor a status-update API exists, and staff
 * authentication is an open decision (docs/PRD.md section 9). So:
 *  - "Demo data" renders the shared merchant fixtures (demoOrders.ts), always
 *    labelled DEMO DATA on screen;
 *  - "Live data" probes the real health route and reports honestly that the
 *    backend is unreachable, or reachable but without a kitchen feed;
 *  - every status-change control is disabled and labelled "Coming soon". No
 *    update is simulated (docs/UX_FLOWS.md flow 4: never imply a failed update
 *    succeeded).
 */

type Source = 'demo' | 'live';

type Feed =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'demo';
      readonly orders: readonly OrderResponse[];
      readonly refreshedAt: number;
    }
  | { readonly kind: 'backendUnavailable'; readonly checkedAt: number }
  | { readonly kind: 'liveUnavailable'; readonly checkedAt: number };

/** Wall clock, re-read on an interval so the header and elapsed times move. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useFeed(source: Source, attempt: number): Feed {
  const [feed, setFeed] = useState<Feed>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (source === 'demo') {
      // Re-reading the fixtures is the only "refresh" demo mode can honestly do.
      setFeed({ kind: 'demo', orders: DEMO_ORDERS, refreshedAt: Date.now() });
      return;
    }
    setFeed({ kind: 'loading' });
    getHealth()
      .then(() => {
        if (!cancelled) setFeed({ kind: 'liveUnavailable', checkedAt: Date.now() });
      })
      .catch(() => {
        if (!cancelled) setFeed({ kind: 'backendUnavailable', checkedAt: Date.now() });
      });
    return () => {
      cancelled = true;
    };
  }, [source, attempt]);

  return feed;
}

/** Clock and timestamp formats in the UI language's locale. */
function useFormats(locale: string) {
  return useMemo(
    () => ({
      clockDate: new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      clockTime: new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
      }),
      stampTime: new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }),
    }),
    [locale],
  );
}

export function KitchenDisplay({
  outletId,
}: {
  outletId: string | undefined;
}): JSX.Element {
  const { t, tp, rich, locale } = useI18n();
  const { clockDate, clockTime, stampTime } = useFormats(locale);
  const [source, setSource] = useState<Source>('demo');
  const [attempt, setAttempt] = useState(0);
  const feed = useFeed(source, attempt);
  const now = useNow(15_000);

  const board =
    feed.kind === 'demo' && outletId !== undefined
      ? buildBoard(feed.orders, outletId)
      : undefined;
  const refresh = (): void => setAttempt((n) => n + 1);

  let content: ReactNode;
  if (outletId === undefined) {
    content = (
      <KitchenState title={t('k.noOutletTitle')}>
        {rich('k.noOutletBody', { example: <code>#/kitchen?outlet=demo-outlet</code> })}
      </KitchenState>
    );
  } else if (feed.kind === 'loading') {
    content = (
      <KitchenState title={t('k.loadingTitle')}>{t('k.loadingBody')}</KitchenState>
    );
  } else if (feed.kind === 'backendUnavailable') {
    content = (
      <KitchenState
        tone="error"
        title={t('k.backendDownTitle')}
        action={
          <>
            <button
              type="button"
              className="vop-k-button vop-k-button--primary"
              onClick={refresh}
            >
              {t('common.retry')}
            </button>
            <button
              type="button"
              className="vop-k-button"
              onClick={() => setSource('demo')}
            >
              {t('k.showDemo')}
            </button>
          </>
        }
      >
        {t('k.backendDownBody', { time: stampTime.format(feed.checkedAt) })}
      </KitchenState>
    );
  } else if (feed.kind === 'liveUnavailable') {
    content = (
      <KitchenState
        tone="warning"
        title={t('k.liveUnavailableTitle')}
        action={
          <button
            type="button"
            className="vop-k-button"
            onClick={() => setSource('demo')}
          >
            {t('k.showDemo')}
          </button>
        }
      >
        {t('k.liveUnavailableBody')}
      </KitchenState>
    );
  } else if (board !== undefined) {
    content = <Board board={board} now={now} />;
  }

  const lastChecked =
    feed.kind === 'demo'
      ? feed.refreshedAt
      : feed.kind === 'loading'
        ? undefined
        : feed.checkedAt;

  return (
    <div className="vop-k">
      <header className="vop-k-header">
        <div className="vop-k-header__title">
          <h1>{t('k.title')}</h1>
          <p className="vop-k-muted">
            {t('k.outlet')}{' '}
            <strong className="vop-k-outlet">{outletId ?? t('k.notSelected')}</strong>
          </p>
        </div>

        <p className="vop-k-clock">
          <time dateTime={new Date(now).toISOString()}>
            <span className="vop-k-clock__time">{clockTime.format(now)}</span>
            <span className="vop-k-clock__date">{clockDate.format(now)}</span>
          </time>
        </p>

        <Counts board={board} />

        <div className="vop-k-controls">
          {source === 'demo' && (
            <span className="vop-k-demo-tag" role="note">
              {t('k.demoTag')}
            </span>
          )}
          <div className="vop-k-toggle" role="group" aria-label={t('k.source.label')}>
            {(['demo', 'live'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="vop-k-chip"
                aria-pressed={source === value}
                onClick={() => setSource(value)}
              >
                {value === 'demo' ? t('k.source.demo') : t('k.source.live')}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="vop-k-button"
            onClick={refresh}
            disabled={feed.kind === 'loading'}
          >
            {t('k.refresh')}
          </button>
          <LanguageSelect className="vop-k-lang" />
        </div>
      </header>

      {source === 'demo' && (
        <p className="vop-k-banner" role="note">
          <strong>{t('k.bannerStrong')}</strong> {t('k.bannerRest')}
        </p>
      )}

      <main className="vop-k-main">{content}</main>

      <footer className="vop-k-footer" aria-live="polite">
        {lastChecked !== undefined && (
          <span>
            {t(feed.kind === 'demo' ? 'k.lastRefreshed' : 'k.lastChecked', {
              time: stampTime.format(lastChecked),
            })}
          </span>
        )}
        {board !== undefined && board.hiddenCount > 0 && (
          <span>{tp('k.hidden', board.hiddenCount)}</span>
        )}
        <span>{t('k.statusChangesSoon')}</span>
      </footer>
    </div>
  );
}

function Counts({ board }: { board: KitchenBoard | undefined }): JSX.Element {
  const { t } = useI18n();
  return (
    <ul className="vop-k-counts" aria-label={t('k.countsLabel')}>
      {KITCHEN_COLUMNS.map((c) => (
        <li key={c.id} className={`vop-k-count vop-k-count--${c.id}`}>
          <span className="vop-k-count__value">
            {board === undefined ? '–' : board.columns[c.id].length}
          </span>
          <span className="vop-k-count__label">{t(`k.col.${c.id}.title`)}</span>
        </li>
      ))}
    </ul>
  );
}

function Board({ board, now }: { board: KitchenBoard; now: number }): JSX.Element {
  const { t } = useI18n();
  const total = KITCHEN_COLUMNS.reduce((n, c) => n + board.columns[c.id].length, 0);
  if (total === 0) {
    return (
      <KitchenState title={t('k.emptyTitle')}>
        {t('k.emptyBody')}
        {board.hiddenCount > 0 && ` ${t('k.emptyHidden')}`}
      </KitchenState>
    );
  }
  return (
    <div className="vop-k-board">
      {KITCHEN_COLUMNS.map((c) => (
        <Column key={c.id} def={c} orders={board.columns[c.id]} now={now} />
      ))}
    </div>
  );
}

function Column({
  def,
  orders,
  now,
}: {
  def: KitchenColumnDef;
  orders: readonly OrderResponse[];
  now: number;
}): JSX.Element {
  const { t } = useI18n();
  const headingId = `vop-k-col-${def.id}`;
  return (
    <section
      className={`vop-k-column vop-k-column--${def.id}`}
      aria-labelledby={headingId}
    >
      <header className="vop-k-column__head">
        <h2 id={headingId}>
          {t(`k.col.${def.id}.title`)}{' '}
          <span className="vop-k-column__count">{orders.length}</span>
        </h2>
        <p className="vop-k-muted">{t(`k.col.${def.id}.description`)}</p>
      </header>
      {orders.length === 0 ? (
        <p className="vop-k-column__empty">{t(`k.col.${def.id}.empty`)}</p>
      ) : (
        <ol className="vop-k-tickets">
          {orders.map((o) => (
            <li key={o.orderId}>
              <Ticket order={o} def={def} now={now} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Ticket({
  order,
  def,
  now,
}: {
  order: OrderResponse;
  def: KitchenColumnDef;
  now: number;
}): JSX.Element {
  const { t, language } = useI18n();
  const minutes = elapsedMinutes(order.createdAt, now);
  const level = ageLevel(minutes, order.orderStatus);
  const statusLabel = kitchenStatusLabel(order.orderStatus, language);
  const elapsed = formatElapsed(minutes, language);

  return (
    <article
      className={`vop-k-ticket vop-k-ticket--${level}`}
      aria-label={
        minutes >= 1
          ? t('k.ticket.ariaAgo', { token: order.token, status: statusLabel, elapsed })
          : t('k.ticket.ariaNow', { token: order.token, status: statusLabel })
      }
    >
      <div className="vop-k-ticket__head">
        <p className="vop-k-ticket__token">
          <span className="vop-k-ticket__token-label">{t('k.ticket.token')}</span>
          {order.token}
        </p>
        <span className={`vop-k-status vop-k-status--${order.orderStatus}`}>
          {statusLabel}
        </span>
      </div>

      <p className="vop-k-ticket__meta vop-k-muted">
        {t('k.ticket.order', {
          orderId: order.orderId,
          channel: t(order.channel === 'qr' ? 'common.qr' : 'common.kiosk'),
        })}
      </p>

      <p className="vop-k-ticket__time">
        <span>
          <time dateTime={order.createdAt}>
            {t('k.ticket.received', {
              time: formatOrderTime(order.createdAt, language),
            })}
          </time>
        </span>
        <span className="vop-k-ticket__elapsed">
          {elapsed}
          {level !== 'normal' && (
            <span className="vop-k-age-tag">{t(`k.age.${level}`)}</span>
          )}
        </span>
      </p>

      <ul className="vop-k-items">
        {order.items.map((item, index) => {
          const addOns = addOnLabel(item.optionIds.length, language);
          return (
            <li key={`${item.menuItemId}-${index}`} className="vop-k-item">
              <span className="vop-k-item__qty">{item.quantity}×</span>
              <span className="vop-k-item__name">
                {item.nameAtOrder}
                {addOns !== undefined && (
                  <span className="vop-k-item__addons">{addOns}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="vop-k-ticket__pay vop-k-muted">
        {t('k.ticket.payment', {
          status: paymentStatusStaffLabel(order.paymentStatus, language),
        })}
      </p>

      <button
        type="button"
        className="vop-k-button vop-k-ticket__action"
        disabled
        title={t('k.ticket.actionTitle')}
      >
        {t(`k.col.${def.id}.action`)}
        <span className="vop-k-soon">{t('common.comingSoon')}</span>
      </button>
    </article>
  );
}

function KitchenState({
  tone = 'neutral',
  title,
  children,
  action,
}: {
  tone?: 'neutral' | 'warning' | 'error';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`vop-k-state vop-k-state--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p className="vop-k-state__title">{title}</p>
      {children !== undefined && <p className="vop-k-state__body">{children}</p>}
      {action !== undefined && <div className="vop-k-state__action">{action}</div>}
    </div>
  );
}

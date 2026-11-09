import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { OrderResponse } from '@vop/shared';
import { getHealth } from '../api/client';
import { DEMO_ORDERS } from '../merchant/demoOrders';
import {
  PAYMENT_STATUS_STAFF_LABELS,
  formatOrderTime,
} from '../merchant/merchantRules';
import {
  KITCHEN_COLUMNS,
  KITCHEN_STATUS_LABELS,
  addOnLabel,
  ageLevel,
  buildBoard,
  elapsedMinutes,
  formatElapsed,
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

const CHANNEL_LABELS = { qr: 'QR', kiosk: 'Kiosk' } as const;

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

const clockDate = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const clockTime = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
});
const stampTime = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

export function KitchenDisplay({
  outletId,
}: {
  outletId: string | undefined;
}): JSX.Element {
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
      <KitchenState title="Which outlet?">
        This link does not name an outlet, so no orders can be shown. Open{' '}
        <code>#/kitchen?outlet=demo-outlet</code>.
      </KitchenState>
    );
  } else if (feed.kind === 'loading') {
    content = (
      <KitchenState title="Loading kitchen orders…">Checking the backend.</KitchenState>
    );
  } else if (feed.kind === 'backendUnavailable') {
    content = (
      <KitchenState
        tone="error"
        title="Backend unavailable"
        action={
          <>
            <button
              type="button"
              className="vop-k-button vop-k-button--primary"
              onClick={refresh}
            >
              Retry
            </button>
            <button
              type="button"
              className="vop-k-button"
              onClick={() => setSource('demo')}
            >
              Show demo data
            </button>
          </>
        }
      >
        The kitchen display could not reach the server (checked at{' '}
        {stampTime.format(feed.checkedAt)}). This does not mean there are no orders —
        check that the backend is running.
      </KitchenState>
    );
  } else if (feed.kind === 'liveUnavailable') {
    content = (
      <KitchenState
        tone="warning"
        title="Live kitchen data unavailable"
        action={
          <button
            type="button"
            className="vop-k-button"
            onClick={() => setSource('demo')}
          >
            Show demo data
          </button>
        }
      >
        The backend is reachable, but it has no kitchen order feed yet, and staff
        sign-in is not decided. Live tickets will appear here once both exist.
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
          <h1>Kitchen</h1>
          <p className="vop-k-muted">
            Outlet:{' '}
            <strong className="vop-k-outlet">{outletId ?? 'not selected'}</strong>
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
              DEMO DATA
            </span>
          )}
          <div className="vop-k-toggle" role="group" aria-label="Data source">
            {(['demo', 'live'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="vop-k-chip"
                aria-pressed={source === value}
                onClick={() => setSource(value)}
              >
                {value === 'demo' ? 'Demo data' : 'Live data'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="vop-k-button"
            onClick={refresh}
            disabled={feed.kind === 'loading'}
          >
            Refresh
          </button>
        </div>
      </header>

      {source === 'demo' && (
        <p className="vop-k-banner" role="note">
          <strong>Demo data.</strong> These tickets are sample fixtures, not this
          outlet&apos;s live orders. A live kitchen feed needs the kitchen API and staff
          sign-in, which are not built yet.
        </p>
      )}

      <main className="vop-k-main">{content}</main>

      <footer className="vop-k-footer" aria-live="polite">
        {lastChecked !== undefined && (
          <span>
            {feed.kind === 'demo' ? 'Last refreshed' : 'Last checked'}{' '}
            {stampTime.format(lastChecked)}
          </span>
        )}
        {board !== undefined && board.hiddenCount > 0 && (
          <span>
            {board.hiddenCount} collected or cancelled{' '}
            {board.hiddenCount === 1 ? 'order is' : 'orders are'} not shown
          </span>
        )}
        <span>
          Status changes are coming soon: they need the kitchen API and staff sign-in.
        </span>
      </footer>
    </div>
  );
}

function Counts({ board }: { board: KitchenBoard | undefined }): JSX.Element {
  return (
    <ul className="vop-k-counts" aria-label="Orders by status">
      {KITCHEN_COLUMNS.map((c) => (
        <li key={c.id} className={`vop-k-count vop-k-count--${c.id}`}>
          <span className="vop-k-count__value">
            {board === undefined ? '–' : board.columns[c.id].length}
          </span>
          <span className="vop-k-count__label">{c.title}</span>
        </li>
      ))}
    </ul>
  );
}

function Board({ board, now }: { board: KitchenBoard; now: number }): JSX.Element {
  const total = KITCHEN_COLUMNS.reduce((n, c) => n + board.columns[c.id].length, 0);
  if (total === 0) {
    return (
      <KitchenState title="No orders in the kitchen">
        New orders for this outlet will appear here.
        {board.hiddenCount > 0 && ' Collected and cancelled orders are not shown.'}
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
  const headingId = `vop-k-col-${def.id}`;
  return (
    <section
      className={`vop-k-column vop-k-column--${def.id}`}
      aria-labelledby={headingId}
    >
      <header className="vop-k-column__head">
        <h2 id={headingId}>
          {def.title} <span className="vop-k-column__count">{orders.length}</span>
        </h2>
        <p className="vop-k-muted">{def.description}</p>
      </header>
      {orders.length === 0 ? (
        <p className="vop-k-column__empty">{def.emptyText}</p>
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

const AGE_TAGS = { watch: 'Long wait', late: 'Very long wait' } as const;

function Ticket({
  order,
  def,
  now,
}: {
  order: OrderResponse;
  def: KitchenColumnDef;
  now: number;
}): JSX.Element {
  const minutes = elapsedMinutes(order.createdAt, now);
  const level = ageLevel(minutes, order.orderStatus);
  const statusLabel = KITCHEN_STATUS_LABELS[order.orderStatus];

  return (
    <article
      className={`vop-k-ticket vop-k-ticket--${level}`}
      aria-label={`Token ${order.token}, ${statusLabel}, received ${minutes >= 1 ? `${formatElapsed(minutes)} ago` : 'just now'}`}
    >
      <div className="vop-k-ticket__head">
        <p className="vop-k-ticket__token">
          <span className="vop-k-ticket__token-label">Token</span>
          {order.token}
        </p>
        <span className={`vop-k-status vop-k-status--${order.orderStatus}`}>
          {statusLabel}
        </span>
      </div>

      <p className="vop-k-ticket__meta vop-k-muted">
        Order {order.orderId} · {CHANNEL_LABELS[order.channel]}
      </p>

      <p className="vop-k-ticket__time">
        <span>
          Received{' '}
          <time dateTime={order.createdAt}>{formatOrderTime(order.createdAt)}</time>
        </span>
        <span className="vop-k-ticket__elapsed">
          {formatElapsed(minutes)}
          {level !== 'normal' && (
            <span className="vop-k-age-tag">{AGE_TAGS[level]}</span>
          )}
        </span>
      </p>

      <ul className="vop-k-items">
        {order.items.map((item, index) => {
          const addOns = addOnLabel(item.optionIds.length);
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
        Payment: {PAYMENT_STATUS_STAFF_LABELS[order.paymentStatus]}
      </p>

      <button
        type="button"
        className="vop-k-button vop-k-ticket__action"
        disabled
        title="Coming soon: needs the kitchen API and staff sign-in"
      >
        {def.nextAction}
        <span className="vop-k-soon">Coming soon</span>
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

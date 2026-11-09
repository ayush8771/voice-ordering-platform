import { useEffect, useState, type JSX } from 'react';
import type { MenuResponse } from '@vop/shared';
import { ApiRequestError, getMenu } from '../api/client';
import { formatMoney } from '../customer/cartRules';
import { menuSections } from '../customer/menuDiscovery';
import { ComingSoonButton, StateMessage } from './components';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly menu: MenuResponse }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Read-only view of the outlet's menu, from the same public menu route the
 * customer pages use. No merchant menu API exists, so add, edit and
 * availability controls are disabled and nothing is saved.
 */
export function MenuManagementPage({
  outletId,
}: {
  outletId: string | undefined;
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (outletId === undefined) return;
    let cancelled = false;
    setLoad({ kind: 'loading' });
    getMenu(outletId)
      .then((menu) => !cancelled && setLoad({ kind: 'ready', menu }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoad({
          kind: 'error',
          message:
            error instanceof ApiRequestError
              ? error.message
              : 'The server could not be reached.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [outletId, attempt]);

  const toolbar = (
    <div className="vop-m-toolbar">
      <p className="vop-m-note">
        Live public menu, read-only. Editing needs a merchant menu API, which does not
        exist yet — nothing here is saved.
      </p>
      <ComingSoonButton>+ Add item</ComingSoonButton>
    </div>
  );

  if (outletId === undefined) {
    return (
      <StateMessage tone="warning" title="No outlet selected">
        Open this page with an outlet, for example{' '}
        <code>#/merchant/menu?outlet=demo-outlet</code>.
      </StateMessage>
    );
  }
  if (load.kind === 'loading') {
    return <StateMessage title="Loading menu…" />;
  }
  if (load.kind === 'error') {
    return (
      <StateMessage
        tone="error"
        title="Menu unavailable"
        action={
          <button
            type="button"
            className="vop-m-button vop-m-button--primary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        }
      >
        {load.message}
      </StateMessage>
    );
  }

  const sections = menuSections(load.menu);
  if (sections.length === 0) {
    return (
      <>
        {toolbar}
        <StateMessage title="No menu items">
          This outlet has not published any items yet.
        </StateMessage>
      </>
    );
  }

  return (
    <>
      {toolbar}
      {sections.map(({ category, items }) => (
        <section
          key={category.id === '' ? 'other' : category.id}
          className="vop-m-card vop-m-menu-section"
          aria-labelledby={`vop-m-cat-${category.id || 'other'}`}
        >
          <h2 id={`vop-m-cat-${category.id || 'other'}`}>
            {category.name}{' '}
            <span className="vop-m-muted">
              ({items.length} {items.length === 1 ? 'item' : 'items'})
            </span>
          </h2>
          <ul className="vop-m-menu">
            {items.map((item) => (
              <li key={item.id} className="vop-m-menu__item">
                <div className="vop-m-menu__main">
                  <p className="vop-m-menu__name">{item.name}</p>
                  {item.description !== undefined && (
                    <p className="vop-m-muted">{item.description}</p>
                  )}
                  {item.options.length > 0 && (
                    <p className="vop-m-menu__options">
                      Add-ons:{' '}
                      {item.options
                        .map(
                          (o) =>
                            `${o.label}${o.priceDeltaMinor === 0 ? '' : ` (${o.priceDeltaMinor > 0 ? '+' : '−'}${formatMoney(Math.abs(o.priceDeltaMinor), item.currency)})`}`,
                        )
                        .join(', ')}
                    </p>
                  )}
                </div>
                <p className="vop-m-amount">
                  {formatMoney(item.priceMinor, item.currency)}
                </p>
                <span
                  className={`vop-m-badge ${item.available ? 'vop-m-badge--ready' : 'vop-m-badge--cancelled'}`}
                >
                  {item.available ? 'Available' : 'Sold out'}
                </span>
                <div className="vop-m-menu__actions">
                  <ComingSoonButton>Edit</ComingSoonButton>
                  <ComingSoonButton>
                    {item.available ? 'Mark sold out' : 'Mark available'}
                  </ComingSoonButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

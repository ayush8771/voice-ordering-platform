import { useEffect, useState, type JSX } from 'react';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { readOutletId } from '../customer/useOrdering';
import { DemoBanner, SourceToggle } from './components';
import { DashboardOverview } from './DashboardOverview';
import { DEMO_ORDERS } from './demoOrders';
import { LiveUnavailable } from './LiveUnavailable';
import { MenuManagementPage } from './MenuManagementPage';
import { OrdersPage } from './OrdersPage';
import { readMerchantPage, type MerchantPage } from './merchantRules';
import './merchant.css';

/**
 * Merchant dashboard shell: sidebar on desktop, a compact top bar with a
 * horizontal nav on smaller screens.
 *
 * Staff authentication is an open decision (docs/PRD.md section 9), so there
 * is no sign-in, the identity shown is a placeholder, and no privileged
 * action is performed. Orders are sample fixtures (see demoOrders.ts); the
 * menu page reads the public menu route only.
 */

const PAGES: readonly { id: MerchantPage; label: string; path: string }[] = [
  { id: 'overview', label: 'Dashboard', path: '#/merchant' },
  { id: 'orders', label: 'Orders', path: '#/merchant/orders' },
  { id: 'menu', label: 'Menu', path: '#/merchant/menu' },
];

const TITLES: Record<MerchantPage, string> = {
  overview: "Today's overview",
  orders: 'Orders',
  menu: 'Menu management',
};

export function MerchantDashboard(): JSX.Element {
  const [hash, setHash] = useState(() => window.location.hash);
  const [source, setSource] = useState<'demo' | 'live'>('demo');

  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const page = readMerchantPage(hash);
  const outletId = readOutletId(window.location.search, hash);
  // Keep the outlet in nav links so moving between pages does not lose it.
  const query = outletId === undefined ? '' : `?outlet=${encodeURIComponent(outletId)}`;
  const usesOrders = page !== 'menu';

  return (
    <div className="vop-m">
      <aside className="vop-m-sidebar">
        <div className="vop-m-brand">
          <p className="vop-m-brand__name">Voice Ordering</p>
          <p className="vop-m-brand__outlet">
            Outlet: {outletId ?? <span className="vop-m-muted">not selected</span>}
          </p>
        </div>
        <nav aria-label="Merchant">
          <ul className="vop-m-nav">
            {PAGES.map((p) => (
              <li key={p.id}>
                <a
                  className="vop-m-nav__link"
                  href={`${p.path}${query}`}
                  aria-current={page === p.id ? 'page' : undefined}
                >
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="vop-m-identity">
          <span className="vop-m-avatar" aria-hidden="true">
            S
          </span>
          <span>
            <span className="vop-m-identity__name">Staff member</span>
            <span className="vop-m-muted vop-m-identity__note">
              Sign-in not available yet
            </span>
          </span>
        </div>
      </aside>

      <main className="vop-m-main">
        <header className="vop-m-header">
          <h1>{TITLES[page]}</h1>
          {usesOrders && <SourceToggle source={source} onChange={setSource} />}
        </header>

        {usesOrders && source === 'demo' && <DemoBanner />}

        {page === 'menu' ? (
          <MenuManagementPage outletId={outletId} />
        ) : source === 'live' ? (
          <LiveUnavailable onUseDemo={() => setSource('demo')} />
        ) : page === 'orders' ? (
          <OrdersPage orders={DEMO_ORDERS} />
        ) : (
          <DashboardOverview
            orders={DEMO_ORDERS}
            ordersHref={`#/merchant/orders${query}`}
          />
        )}

        <footer className="vop-m-footer">
          <ConnectionStatus />
        </footer>
      </main>
    </div>
  );
}

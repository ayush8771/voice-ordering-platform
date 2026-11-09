import { useEffect, useState, type JSX } from 'react';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { readOutletId } from '../customer/useOrdering';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageSelect } from '../i18n/LanguagePicker';
import type { MessageKey } from '../i18n/translate';
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

const PAGES: readonly { id: MerchantPage; label: MessageKey; path: string }[] = [
  { id: 'overview', label: 'm.nav.overview', path: '#/merchant' },
  { id: 'orders', label: 'm.nav.orders', path: '#/merchant/orders' },
  { id: 'menu', label: 'm.nav.menu', path: '#/merchant/menu' },
];

const TITLES: Record<MerchantPage, MessageKey> = {
  overview: 'm.title.overview',
  orders: 'm.title.orders',
  menu: 'm.title.menu',
};

export function MerchantDashboard(): JSX.Element {
  const { t } = useI18n();
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
          <p className="vop-m-brand__name">{t('m.brand')}</p>
          <p className="vop-m-brand__outlet">
            {t('m.outlet')}{' '}
            {outletId ?? <span className="vop-m-muted">{t('m.notSelected')}</span>}
          </p>
        </div>
        <nav aria-label={t('m.navLabel')}>
          <ul className="vop-m-nav">
            {PAGES.map((p) => (
              <li key={p.id}>
                <a
                  className="vop-m-nav__link"
                  href={`${p.path}${query}`}
                  aria-current={page === p.id ? 'page' : undefined}
                >
                  {t(p.label)}
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
            <span className="vop-m-identity__name">{t('m.staff')}</span>
            <span className="vop-m-muted vop-m-identity__note">
              {t('m.signInUnavailable')}
            </span>
          </span>
        </div>
      </aside>

      <main className="vop-m-main">
        <header className="vop-m-header">
          <h1>{t(TITLES[page])}</h1>
          <span className="vop-m-header__tools">
            {usesOrders && <SourceToggle source={source} onChange={setSource} />}
            <LanguageSelect className="vop-m-lang" />
          </span>
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

import { Suspense, lazy, useEffect, useState, type JSX } from 'react';
import { I18nProvider } from './i18n/I18nProvider';
import { CustomerShell } from './pages/CustomerShell';
import { KitchenShell } from './pages/KitchenShell';
import { MerchantShell } from './pages/MerchantShell';
import { isKitchenHash } from './kitchen/kitchenRules';

/**
 * Minimal hash-based surface switch for the foundation milestone.
 *
 * A routing library is deliberately not added yet: client routing structure
 * depends on the still-open tooling decision (docs/PRD.md section 9). Replace
 * this with a reviewed router when that is settled.
 *
 *   #/            customer QR mobile
 *   #/kiosk       customer kiosk
 *   #/merchant    merchant dashboard
 *   #/kitchen     kitchen display (`#/kitchen?outlet=<id>`)
 *   #/payment-preview  payment-state design reference (development builds only)
 */
function readSurface(
  hash: string,
): 'qr' | 'kiosk' | 'merchant' | 'kitchen' | 'paymentPreview' {
  if (isKitchenHash(hash)) return 'kitchen';
  // Design reference only; never reachable in a production build.
  if (import.meta.env.DEV && hash.startsWith('#/payment-preview'))
    return 'paymentPreview';
  if (hash.startsWith('#/merchant')) return 'merchant';
  if (hash.startsWith('#/kiosk')) return 'kiosk';
  return 'qr';
}

/** Loaded only in development; production builds drop the module entirely. */
const PaymentStatePreview = import.meta.env.DEV
  ? lazy(() =>
      import('./customer/PaymentStatePreview').then((m) => ({
        default: m.PaymentStatePreview,
      })),
    )
  : undefined;

/**
 * One language provider for every surface: the choice persists across reloads
 * and sets the document language. It holds UI state only.
 */
export function App(): JSX.Element {
  return (
    <I18nProvider>
      <Surface />
    </I18nProvider>
  );
}

function Surface(): JSX.Element {
  const [surface, setSurface] = useState(() => readSurface(window.location.hash));

  useEffect(() => {
    const onHashChange = (): void => setSurface(readSurface(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (surface === 'merchant') return <MerchantShell />;
  if (surface === 'kitchen') return <KitchenShell />;
  if (surface === 'paymentPreview' && PaymentStatePreview !== undefined) {
    return (
      <Suspense fallback={null}>
        <PaymentStatePreview />
      </Suspense>
    );
  }
  return <CustomerShell channel={surface === 'kiosk' ? 'kiosk' : 'qr'} />;
}

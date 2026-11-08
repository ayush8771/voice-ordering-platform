import { useEffect, useState, type JSX } from 'react';
import { CustomerShell } from './pages/CustomerShell';
import { MerchantShell } from './pages/MerchantShell';

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
 */
function readSurface(hash: string): 'qr' | 'kiosk' | 'merchant' {
  if (hash.startsWith('#/merchant')) return 'merchant';
  if (hash.startsWith('#/kiosk')) return 'kiosk';
  return 'qr';
}

export function App(): JSX.Element {
  const [surface, setSurface] = useState(() => readSurface(window.location.hash));

  useEffect(() => {
    const onHashChange = (): void => setSurface(readSurface(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (surface === 'merchant') return <MerchantShell />;
  return <CustomerShell channel={surface === 'kiosk' ? 'kiosk' : 'qr'} />;
}

import { useEffect, useState, type JSX } from 'react';
import { readOutletId } from '../customer/useOrdering';
import { KitchenDisplay } from '../kitchen/KitchenDisplay';

/**
 * Kitchen display entry point: `#/kitchen?outlet=<id>`.
 * Staff authentication is an open decision (docs/PRD.md section 9), so the
 * display shows labelled demo tickets and performs no privileged action.
 */
export function KitchenShell(): JSX.Element {
  // App does not re-render for a hash change within the same surface, so a
  // changed `?outlet=` must be picked up here.
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const outletId = readOutletId(window.location.search, hash);
  return <KitchenDisplay key={outletId ?? ''} outletId={outletId} />;
}

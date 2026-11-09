import type { JSX } from 'react';
import { MerchantDashboard } from '../merchant/MerchantDashboard';

/**
 * Merchant/kitchen surface entry point.
 * Staff authentication is an open decision (docs/PRD.md section 9), so the
 * dashboard shows sample orders and a read-only menu, and performs no
 * privileged action.
 */
export function MerchantShell(): JSX.Element {
  return <MerchantDashboard />;
}

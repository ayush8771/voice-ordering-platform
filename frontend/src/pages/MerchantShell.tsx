import type { JSX } from 'react';
import { ConnectionStatus } from '../components/ConnectionStatus';

/**
 * Placeholder shell for the merchant/kitchen dashboard.
 * Staff authentication is an open decision (docs/PRD.md section 9), so this
 * renders no staff data and performs no privileged action.
 */
export function MerchantShell(): JSX.Element {
  return (
    <main style={{ maxWidth: '1100px', margin: '0 auto', padding: 'var(--space-4)' }}>
      <h1>Merchant / kitchen dashboard</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Foundation scaffold. Order queue, status transitions and menu availability are
        not implemented yet. Staff authentication is undecided, so no protected data is
        exposed here.
      </p>
      <ConnectionStatus />
    </main>
  );
}

import type { JSX } from 'react';
import type { Channel } from '@vop/shared';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { CustomerOrdering } from '../customer/CustomerOrdering';
import { readOutletId } from '../customer/useOrdering';

/**
 * Customer entry point for both channels.
 *
 * The outlet comes from the URL the QR code or the kiosk launcher carries
 * (`?outlet=<id>`, or `#/kiosk?outlet=<id>`). The session ID never travels in a
 * URL (docs/SECURITY.md section 5); only the public outlet ID does, which is
 * also what the printed menu would show.
 *
 * No speech client is passed: the backend speech routes do not exist and the
 * Gnani schemas are unverified, so the surface runs touch-and-type only
 * (docs/PROVIDERS.md).
 */
export function CustomerShell({ channel }: { channel: Channel }): JSX.Element {
  const outletId = readOutletId(window.location.search, window.location.hash);

  if (outletId === undefined) {
    return (
      <main style={{ maxWidth: '480px', margin: '0 auto', padding: 'var(--space-4)' }}>
        <h1>Which outlet?</h1>
        <p>
          This link does not name an outlet, so no menu can be loaded. Scan the QR code
          on your table, or ask at the counter.
        </p>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Developer note: open <code>?outlet=demo-outlet</code> (or{' '}
          <code>#/kiosk?outlet=demo-outlet</code>) against a seeded backend.
        </p>
        <ConnectionStatus />
      </main>
    );
  }

  return <CustomerOrdering outletId={outletId} channel={channel} />;
}

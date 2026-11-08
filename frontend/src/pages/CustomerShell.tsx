import type { JSX } from 'react';
import type { Channel } from '@vop/shared';
import { ConnectionStatus } from '../components/ConnectionStatus';

/**
 * Placeholder shell for the customer experience (QR and kiosk channels).
 * No menu, cart, voice or ordering behavior yet - those are later milestones.
 */
export function CustomerShell({ channel }: { channel: Channel }): JSX.Element {
  const isKiosk = channel === 'kiosk';

  return (
    <main
      style={{
        maxWidth: isKiosk ? '900px' : '480px',
        margin: '0 auto',
        padding: 'var(--space-4)',
        fontSize: isKiosk ? 'var(--font-size-kiosk-body)' : 'var(--font-size-body)',
      }}
    >
      <h1>Customer ordering ({isKiosk ? 'kiosk' : 'QR mobile'})</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Foundation scaffold. Menu, cart, review/confirm and voice input are not
        implemented yet.
      </p>
      <ConnectionStatus />
    </main>
  );
}

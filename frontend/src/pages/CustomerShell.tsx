import type { JSX } from 'react';
import type { Channel } from '@vop/shared';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { CustomerOrdering } from '../customer/CustomerOrdering';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageChoice } from '../i18n/LanguagePicker';
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
  const { t, rich } = useI18n();
  const outletId = readOutletId(window.location.search, window.location.hash);

  if (outletId === undefined) {
    return (
      <main style={{ maxWidth: '480px', margin: '0 auto', padding: 'var(--space-4)' }}>
        <LanguageChoice />
        <h1>{t('shell.whichOutlet')}</h1>
        <p>{t('shell.noOutlet')}</p>
        <p style={{ color: 'var(--color-text-muted)' }}>
          {rich('shell.devNote', {
            qr: <code>?outlet=demo-outlet</code>,
            kiosk: <code>#/kiosk?outlet=demo-outlet</code>,
          })}
        </p>
        <ConnectionStatus />
      </main>
    );
  }

  return <CustomerOrdering outletId={outletId} channel={channel} />;
}

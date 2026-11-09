import { useEffect, useState, type JSX } from 'react';
import type { HealthResponse } from '@vop/shared';
import { ApiRequestError, getHealth } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthResponse }
  /** `message` is the server's own text; undefined means a network failure. */
  | { kind: 'error'; message: string | undefined };

/**
 * Verifies client/server communication for the foundation milestone.
 *
 * A failed check reports the failure explicitly rather than rendering an empty
 * or falsely healthy state (docs/UX_FLOWS.md, docs/DESIGN_SYSTEM.md section 5).
 * Status is conveyed by text, not color alone.
 */
export function ConnectionStatus(): JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;

    getHealth()
      .then((health) => {
        if (active) setState({ kind: 'ok', health });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message:
            error instanceof ApiRequestError && error.status !== 0
              ? error.message
              : undefined,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      aria-live="polite"
      style={{
        marginTop: 'var(--space-6)',
        padding: 'var(--space-4)',
        background: 'var(--color-surface)',
        border: `1px solid var(--color-border)`,
        borderRadius: 'var(--radius-md)',
      }}
    >
      <h2 style={{ fontSize: 'var(--font-size-body)', marginTop: 0 }}>
        {t('conn.heading')}
      </h2>

      {state.kind === 'loading' && <p>{t('conn.checking')}</p>}

      {state.kind === 'error' && (
        <p style={{ color: 'var(--color-error)' }}>
          {t('conn.error', { message: state.message ?? t('error.network') })}
        </p>
      )}

      {state.kind === 'ok' && (
        <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
          <div>
            <dt style={{ color: 'var(--color-text-muted)' }}>{t('conn.apiStatus')}</dt>
            <dd style={{ margin: 0, color: 'var(--color-success)' }}>
              {t('conn.connected', {
                status: state.health.status,
                version: state.health.apiVersion,
              })}
            </dd>
          </div>
          <div>
            <dt style={{ color: 'var(--color-text-muted)' }}>{t('conn.mongodb')}</dt>
            <dd style={{ margin: 0 }}>{state.health.dependencies.mongodb}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

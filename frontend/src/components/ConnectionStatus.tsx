import { useEffect, useState, type JSX } from 'react';
import type { HealthResponse } from '@vop/shared';
import { ApiRequestError, getHealth } from '../api/client';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthResponse }
  | { kind: 'error'; message: string };

/**
 * Verifies client/server communication for the foundation milestone.
 *
 * A failed check reports the failure explicitly rather than rendering an empty
 * or falsely healthy state (docs/UX_FLOWS.md, docs/DESIGN_SYSTEM.md section 5).
 * Status is conveyed by text, not color alone.
 */
export function ConnectionStatus(): JSX.Element {
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
            error instanceof ApiRequestError
              ? error.message
              : 'Could not reach the server.',
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
        Backend connection
      </h2>

      {state.kind === 'loading' && <p>Checking the connection to the API…</p>}

      {state.kind === 'error' && (
        <p style={{ color: 'var(--color-error)' }}>
          Not connected: {state.message} Start the backend and reload.
        </p>
      )}

      {state.kind === 'ok' && (
        <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
          <div>
            <dt style={{ color: 'var(--color-text-muted)' }}>API status</dt>
            <dd style={{ margin: 0, color: 'var(--color-success)' }}>
              Connected — {state.health.status} ({state.health.apiVersion})
            </dd>
          </div>
          <div>
            <dt style={{ color: 'var(--color-text-muted)' }}>MongoDB</dt>
            <dd style={{ margin: 0 }}>{state.health.dependencies.mongodb}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

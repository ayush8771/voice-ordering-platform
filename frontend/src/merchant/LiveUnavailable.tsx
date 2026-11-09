import { useEffect, useState, type JSX } from 'react';
import { getHealth } from '../api/client';
import { StateMessage } from './components';

/**
 * What "Live data" shows today. It checks real backend reachability via the
 * existing health route, then says honestly that no merchant order API
 * exists. It never fabricates live numbers.
 */
export function LiveUnavailable({ onUseDemo }: { onUseDemo: () => void }): JSX.Element {
  const [probe, setProbe] = useState<'loading' | 'reachable' | 'unreachable'>(
    'loading',
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProbe('loading');
    getHealth()
      .then(() => !cancelled && setProbe('reachable'))
      .catch(() => !cancelled && setProbe('unreachable'));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const demoButton = (
    <button type="button" className="vop-m-button" onClick={onUseDemo}>
      Show sample data
    </button>
  );

  if (probe === 'loading') {
    return (
      <StateMessage title="Loading dashboard data…">Checking the backend.</StateMessage>
    );
  }
  if (probe === 'unreachable') {
    return (
      <StateMessage
        tone="error"
        title="Backend connection unavailable"
        action={
          <>
            <button
              type="button"
              className="vop-m-button vop-m-button--primary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry
            </button>
            {demoButton}
          </>
        }
      >
        The dashboard could not reach the server. Check that the backend is running.
      </StateMessage>
    );
  }
  return (
    <StateMessage tone="warning" title="Dashboard data unavailable" action={demoButton}>
      The backend is reachable, but it has no merchant order API yet, and staff sign-in
      is not decided. Live orders will appear here once both exist.
    </StateMessage>
  );
}

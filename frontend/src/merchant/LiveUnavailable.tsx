import { useEffect, useState, type JSX } from 'react';
import { getHealth } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';
import { StateMessage } from './components';

/**
 * What "Live data" shows today. It checks real backend reachability via the
 * existing health route, then says honestly that no merchant order API
 * exists. It never fabricates live numbers.
 */
export function LiveUnavailable({ onUseDemo }: { onUseDemo: () => void }): JSX.Element {
  const { t } = useI18n();
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
      {t('m.live.showSample')}
    </button>
  );

  if (probe === 'loading') {
    return (
      <StateMessage title={t('m.live.loadingTitle')}>
        {t('m.live.loadingBody')}
      </StateMessage>
    );
  }
  if (probe === 'unreachable') {
    return (
      <StateMessage
        tone="error"
        title={t('m.live.backendDownTitle')}
        action={
          <>
            <button
              type="button"
              className="vop-m-button vop-m-button--primary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t('common.retry')}
            </button>
            {demoButton}
          </>
        }
      >
        {t('m.live.backendDownBody')}
      </StateMessage>
    );
  }
  return (
    <StateMessage
      tone="warning"
      title={t('m.live.unavailableTitle')}
      action={demoButton}
    >
      {t('m.live.unavailableBody')}
    </StateMessage>
  );
}

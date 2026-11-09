import type { JSX, ReactNode } from 'react';
import type { OrderStatus, PaymentStatus } from '@vop/shared';
import { useI18n } from '../i18n/I18nProvider';
import { orderStatusStaffLabel, paymentStatusStaffLabel } from './merchantRules';

/** Reusable merchant building blocks. Status is always written, never colour alone. */

export function OrderStatusBadge({ status }: { status: OrderStatus }): JSX.Element {
  const { language } = useI18n();
  return (
    <span className={`vop-m-badge vop-m-badge--${status}`}>
      {orderStatusStaffLabel(status, language)}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }): JSX.Element {
  const { language } = useI18n();
  return (
    <span className={`vop-m-badge vop-m-badge--pay-${status}`}>
      {paymentStatusStaffLabel(status, language)}
    </span>
  );
}

export function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="vop-m-card vop-m-summary">
      <p className="vop-m-summary__label">{label}</p>
      <p className="vop-m-summary__value">{value}</p>
      {hint !== undefined && <p className="vop-m-summary__hint">{hint}</p>}
    </div>
  );
}

/** Loading, empty and error states share one shape. */
export function StateMessage({
  tone = 'neutral',
  title,
  children,
  action,
}: {
  tone?: 'neutral' | 'warning' | 'error';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`vop-m-card vop-m-state vop-m-state--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p className="vop-m-state__title">{title}</p>
      {children !== undefined && <div className="vop-m-state__body">{children}</div>}
      {action !== undefined && <div className="vop-m-state__action">{action}</div>}
    </div>
  );
}

export function DemoBanner(): JSX.Element {
  const { t } = useI18n();
  return (
    <p className="vop-m-banner" role="note">
      <strong>{t('m.demoBannerStrong')}</strong> {t('m.demoBannerRest')}
    </p>
  );
}

/** Data-source switch: demo fixtures, or the (not yet available) live feed. */
export function SourceToggle({
  source,
  onChange,
}: {
  source: 'demo' | 'live';
  onChange: (source: 'demo' | 'live') => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="vop-m-toggle" role="group" aria-label={t('m.source.label')}>
      {(['demo', 'live'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className="vop-m-chip"
          aria-pressed={source === value}
          onClick={() => onChange(value)}
        >
          {value === 'demo' ? t('m.source.demo') : t('m.source.live')}
        </button>
      ))}
    </div>
  );
}

/** A control for an action the backend cannot perform yet. */
export function ComingSoonButton({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="vop-m-button"
      disabled
      title={t('common.comingSoon')}
    >
      {children}
      <span className="vop-m-soon">{t('common.comingSoon')}</span>
    </button>
  );
}

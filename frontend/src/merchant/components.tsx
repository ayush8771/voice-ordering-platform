import type { JSX, ReactNode } from 'react';
import type { OrderStatus, PaymentStatus } from '@vop/shared';
import {
  ORDER_STATUS_STAFF_LABELS,
  PAYMENT_STATUS_STAFF_LABELS,
} from './merchantRules';

/** Reusable merchant building blocks. Status is always written, never colour alone. */

export function OrderStatusBadge({ status }: { status: OrderStatus }): JSX.Element {
  return (
    <span className={`vop-m-badge vop-m-badge--${status}`}>
      {ORDER_STATUS_STAFF_LABELS[status]}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }): JSX.Element {
  return (
    <span className={`vop-m-badge vop-m-badge--pay-${status}`}>
      {PAYMENT_STATUS_STAFF_LABELS[status]}
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
  return (
    <p className="vop-m-banner" role="note">
      <strong>Sample data.</strong> These orders are demo fixtures, not your
      outlet&apos;s live orders. Live order data needs the merchant API and staff
      sign-in, which are not built yet.
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
  return (
    <div className="vop-m-toggle" role="group" aria-label="Data source">
      {(['demo', 'live'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className="vop-m-chip"
          aria-pressed={source === value}
          onClick={() => onChange(value)}
        >
          {value === 'demo' ? 'Sample data' : 'Live data'}
        </button>
      ))}
    </div>
  );
}

/** A control for an action the backend cannot perform yet. */
export function ComingSoonButton({ children }: { children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="vop-m-button" disabled title="Coming soon">
      {children}
      <span className="vop-m-soon">Coming soon</span>
    </button>
  );
}

import type { ChargeAttemptStatus, JobWorkStatus, PaymentRequestStatusV2 } from '../contract/v2';
import { cls } from '../lib/cls';
import { Icon, type IconName } from './Icon';

export type StatusTone = 'mint' | 'solar' | 'flare' | 'ion' | 'ultra' | 'slate';

interface ChipSpec {
  label: string;
  tone: StatusTone;
  icon: IconName;
  struck?: boolean;
  pulse?: boolean;
}

/**
 * Shared Status component (§3.3 & §4.4):
 * - Mint = verified/completed money (always shield-check)
 * - Solar = awaiting/processing/at risk/under review/started without payment (clock) or claimed (pulsing radar)
 * - Flare = overdue/failed/needs attention (alert-triangle) or refunded (undo)
 * - Ion = ready/account active (zap)
 * - Ultra = in progress (static loader)
 * - Slate = not requested/on hold/expired (minus-circle) or cancelled (x-circle + line-through)
 */
export function Status({
  tone,
  icon,
  label,
  struck,
  pulse,
  className,
}: {
  tone: StatusTone;
  icon: IconName;
  label: string;
  struck?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cls('ob-status', 'pd-status-chip', `ob-status--${tone}`, struck && 'is-struck', className)}>
      <Icon name={icon} size={16} pulse={pulse} />
      <span>{label}</span>
    </span>
  );
}

const REQUEST_CHIPS: Record<PaymentRequestStatusV2, ChipSpec> = {
  not_requested: { label: 'Not requested', tone: 'slate', icon: 'minus-circle' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'solar', icon: 'clock' },
  paid: { label: 'Paid', tone: 'mint', icon: 'shield' },
  under_review: { label: 'Under review', tone: 'solar', icon: 'clock' },
  cancelled: { label: 'Cancelled', tone: 'slate', icon: 'x-circle', struck: true },
  refunded: { label: 'Refunded', tone: 'flare', icon: 'undo' },
};

const ATTEMPT_CHIPS: Record<ChargeAttemptStatus, ChipSpec> = {
  account_active: { label: 'Account active', tone: 'ion', icon: 'zap' },
  processing: { label: 'Processing', tone: 'solar', icon: 'clock' },
  succeeded: { label: 'Succeeded', tone: 'mint', icon: 'shield' },
  failed: { label: 'Failed', tone: 'flare', icon: 'alert' },
  expired: { label: 'Expired', tone: 'slate', icon: 'minus-circle' },
  superseded: { label: 'Superseded', tone: 'slate', icon: 'x-circle', struck: true },
};

const JOB_CHIPS: Record<JobWorkStatus, ChipSpec> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'solar', icon: 'clock' },
  ready: { label: 'Ready', tone: 'ion', icon: 'zap' },
  in_progress: { label: 'In progress', tone: 'ultra', icon: 'loader' },
  completed: { label: 'Completed', tone: 'mint', icon: 'shield' },
  on_hold: { label: 'On hold', tone: 'slate', icon: 'minus-circle' },
  cancelled: { label: 'Cancelled', tone: 'slate', icon: 'x-circle', struck: true },
};

export type FlagKind = 'at_risk' | 'overdue' | 'started_without_payment' | 'deposit_paid' | 'customer_claimed';

const FLAG_CHIPS: Record<FlagKind, ChipSpec> = {
  at_risk: { label: 'At risk', tone: 'solar', icon: 'clock' },
  overdue: { label: 'Overdue', tone: 'flare', icon: 'alert' },
  started_without_payment: { label: 'Started without payment', tone: 'solar', icon: 'clock' },
  deposit_paid: { label: 'Deposit paid', tone: 'mint', icon: 'shield' },
  customer_claimed: { label: 'Customer says paid', tone: 'solar', icon: 'radar', pulse: true },
};

export function PaymentStatusChip({ status, overdue }: { status: PaymentRequestStatusV2; overdue?: boolean }) {
  if (overdue && status === 'awaiting_payment') {
    return <Status tone="flare" icon="alert" label="Overdue" />;
  }
  const spec = REQUEST_CHIPS[status];
  return <Status tone={spec.tone} icon={spec.icon} label={spec.label} struck={spec.struck} />;
}

export function AttemptStatusChip({ status }: { status: ChargeAttemptStatus }) {
  const spec = ATTEMPT_CHIPS[status];
  return <Status tone={spec.tone} icon={spec.icon} label={spec.label} struck={spec.struck} />;
}

export function JobStatusChip({ status }: { status: JobWorkStatus }) {
  const spec = JOB_CHIPS[status];
  return <Status tone={spec.tone} icon={spec.icon} label={spec.label} struck={spec.struck} />;
}

export function FlagChip({ flag }: { flag: FlagKind }) {
  const spec = FLAG_CHIPS[flag];
  return <Status tone={spec.tone} icon={spec.icon} label={spec.label} pulse={spec.pulse} />;
}

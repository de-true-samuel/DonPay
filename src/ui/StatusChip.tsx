import type { ChargeAttemptStatus, JobWorkStatus, PaymentRequestStatusV2 } from '../contract/v2';
import { Icon, type IconName } from './Icon';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'scheduled';

interface ChipSpec {
  label: string;
  tone: StatusTone;
  icon?: IconName;
  struck?: boolean;
}

const REQUEST_CHIPS: Record<PaymentRequestStatusV2, ChipSpec> = {
  not_requested: { label: 'Not requested', tone: 'neutral', icon: 'clock' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'warning', icon: 'clock' },
  paid: { label: 'Paid', tone: 'success', icon: 'check' },
  under_review: { label: 'Under review', tone: 'warning', icon: 'alert' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'ban', struck: true },
  refunded: { label: 'Refunded', tone: 'danger', icon: 'refund' },
};

const ATTEMPT_CHIPS: Record<ChargeAttemptStatus, ChipSpec> = {
  account_active: { label: 'Account active', tone: 'info', icon: 'clock' },
  processing: { label: 'Processing', tone: 'warning', icon: 'refresh' },
  succeeded: { label: 'Succeeded', tone: 'success', icon: 'check' },
  failed: { label: 'Failed', tone: 'danger', icon: 'x' },
  expired: { label: 'Expired', tone: 'neutral', icon: 'clock' },
  superseded: { label: 'Superseded', tone: 'neutral', icon: 'ban' },
};

const JOB_CHIPS: Record<JobWorkStatus, ChipSpec> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'warning', icon: 'clock' },
  ready: { label: 'Ready', tone: 'info', icon: 'check' },
  in_progress: { label: 'In progress', tone: 'scheduled', icon: 'refresh' },
  completed: { label: 'Completed', tone: 'success', icon: 'shield' },
  on_hold: { label: 'On hold', tone: 'neutral', icon: 'pause' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'ban', struck: true },
};

export type FlagKind = 'at_risk' | 'overdue' | 'started_without_payment' | 'deposit_paid';

const FLAG_CHIPS: Record<FlagKind, ChipSpec> = {
  at_risk: { label: 'At risk', tone: 'warning', icon: 'alert' },
  overdue: { label: 'Overdue', tone: 'danger', icon: 'alert' },
  started_without_payment: { label: 'Started without payment', tone: 'warning', icon: 'info' },
  deposit_paid: { label: 'Deposit paid', tone: 'success', icon: 'check' },
};

const TONE_STYLE: Record<StatusTone, { bg: string; color: string }> = {
  success: { bg: 'var(--status-success-tint)', color: 'var(--status-success)' },
  warning: { bg: 'var(--status-warning-tint)', color: 'var(--status-warning)' },
  danger: { bg: 'var(--status-danger-tint)', color: 'var(--status-danger)' },
  info: { bg: 'var(--status-info-tint)', color: 'var(--status-info)' },
  neutral: { bg: 'var(--status-neutral-tint)', color: 'var(--status-neutral)' },
  scheduled: { bg: 'var(--status-scheduled-tint)', color: 'var(--status-scheduled)' },
};

function ChipBase({ spec }: { spec: ChipSpec }) {
  const s = TONE_STYLE[spec.tone];
  return (
    <span
      className="pd-status-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 9px',
        borderRadius: 'var(--r-chip)',
        fontSize: '12px',
        fontWeight: 600,
        lineHeight: '16px',
        background: s.bg,
        color: s.color,
        textDecoration: spec.struck ? 'line-through' : undefined,
        whiteSpace: 'nowrap',
      }}
    >
      {spec.icon && <Icon name={spec.icon} size={14} />}
      <span>{spec.label}</span>
    </span>
  );
}

export function PaymentStatusChip({ status, overdue }: { status: PaymentRequestStatusV2; overdue?: boolean }) {
  if (overdue && status === 'awaiting_payment') {
    return <ChipBase spec={{ label: 'Overdue', tone: 'danger', icon: 'alert' }} />;
  }
  return <ChipBase spec={REQUEST_CHIPS[status]} />;
}

export function AttemptStatusChip({ status }: { status: ChargeAttemptStatus }) {
  return <ChipBase spec={ATTEMPT_CHIPS[status]} />;
}

export function JobStatusChip({ status }: { status: JobWorkStatus }) {
  return <ChipBase spec={JOB_CHIPS[status]} />;
}

export function FlagChip({ flag }: { flag: FlagKind }) {
  return <ChipBase spec={FLAG_CHIPS[flag]} />;
}

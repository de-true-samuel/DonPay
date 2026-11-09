import { cls } from '../lib/cls';
import type { JobStatus, RequestStatus } from '../contract/contract';
import { JOB_STATUS, REQUEST_STATUS } from '../lib/labels';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type Trust = 'verified' | 'manual' | 'simulated';

/** Line style carries meaning: solid = verified by Kora, dashed = entered by hand, dotted = sandbox details. */
const TRUST: Record<Trust, { label: string; icon: IconName }> = {
  verified: { label: 'Verified by Kora', icon: 'check' },
  manual: { label: 'Not verified', icon: 'pencil' },
  simulated: { label: 'Simulated', icon: 'flask' },
};

export function TrustBadge({ kind }: { kind: Trust }) {
  const m = TRUST[kind];
  return (
    <span className={cls('pd-trust', `pd-trust--${kind}`)}>
      <Icon name={m.icon} size={14} />{m.label}
    </span>
  );
}

const STATUS_ICON: Record<RequestStatus, IconName> = {
  DRAFT: 'pencil', SCHEDULED: 'clock', SENT: 'clock', PAID: 'check', EXPIRED: 'alert', CANCELLED: 'x',
};

export function StatusPill({ status }: { status: RequestStatus }) {
  const m = REQUEST_STATUS[status];
  return (
    <span className={cls('pd-status', `pd-status--${m.tone}`)}>
      <Icon name={STATUS_ICON[status]} size={14} />{m.label}
    </span>
  );
}

export function JobStatusPill({ status }: { status: JobStatus }) {
  const m = JOB_STATUS[status];
  return <span className={cls('pd-status', `pd-status--${m.tone}`)}>{m.label}</span>;
}

/** Shown only when the rule on the job is met by payments Kora verified. */
export function ReadyBadge() {
  return <span className="pd-ready"><Icon name="check" size={14} />Ready to start</span>;
}

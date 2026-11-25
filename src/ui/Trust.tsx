import { cls } from '../lib/cls';
import type { JobStatus, RequestStatus } from '../contract/contract';
import { JOB_STATUS, REQUEST_STATUS } from '../lib/labels';
import { Status, type StatusTone } from './StatusChip';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type Trust = 'verified' | 'manual' | 'simulated';

/** Line style carries meaning: solid = verified by Kora (Mint), dashed = entered by hand, dotted = sandbox details. */
const TRUST: Record<Trust, { label: string; icon: IconName }> = {
  verified: { label: 'Verified by Kora', icon: 'shield' },
  manual: { label: 'Not verified', icon: 'pencil' },
  simulated: { label: 'Simulated', icon: 'flask' },
};

export function TrustBadge({ kind }: { kind: Trust }) {
  const m = TRUST[kind];
  return (
    <span className={cls('pd-trust', `pd-trust--${kind}`)}>
      <Icon name={m.icon} size={14} />
      <span>{m.label}</span>
    </span>
  );
}

const REQUEST_STATUS_MAP: Record<RequestStatus, { tone: StatusTone; icon: IconName; struck?: boolean }> = {
  DRAFT: { tone: 'slate', icon: 'minus-circle' },
  SCHEDULED: { tone: 'solar', icon: 'clock' },
  SENT: { tone: 'solar', icon: 'clock' },
  PAID: { tone: 'mint', icon: 'shield' },
  EXPIRED: { tone: 'slate', icon: 'minus-circle' },
  CANCELLED: { tone: 'slate', icon: 'x-circle', struck: true },
};

export function StatusPill({ status }: { status: RequestStatus }) {
  const m = REQUEST_STATUS[status];
  const spec = REQUEST_STATUS_MAP[status];
  return <Status tone={spec.tone} icon={spec.icon} label={m.label} struck={spec.struck} />;
}

const JOB_STATUS_MAP: Record<JobStatus, { tone: StatusTone; icon: IconName }> = {
  NOT_STARTED: { tone: 'slate', icon: 'minus-circle' },
  PART_PAID: { tone: 'solar', icon: 'clock' },
  FULLY_PAID: { tone: 'mint', icon: 'shield' },
  CANCELLED: { tone: 'slate', icon: 'x-circle' },
};

export function JobStatusPill({ status }: { status: JobStatus }) {
  const m = JOB_STATUS[status];
  const spec = JOB_STATUS_MAP[status] ?? { tone: 'slate' as StatusTone, icon: 'minus-circle' as IconName };
  return <Status tone={spec.tone} icon={spec.icon} label={m.label} struck={status === 'CANCELLED'} />;
}

/** Shown when the rule on the job is satisfied: Ion for Ready (§3.3). */
export function ReadyBadge() {
  return <Status tone="ion" icon="zap" label="Ready to start" className="pd-ready" />;
}

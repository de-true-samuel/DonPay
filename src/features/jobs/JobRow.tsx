import { Link, useMatch } from 'react-router-dom';
import { cls } from '../../lib/cls';
import type { JobSummary } from '../../contract/contract';
import { Money } from '../../ui/Money';
import { JobStatusPill, ReadyBadge } from '../../ui/Trust';

export function JobRow({ job: j }: { job: JobSummary }) {
  const owes = BigInt(j.balanceKobo) > 0n;
  const active = useMatch('/jobs/:id')?.params.id === j.id;
  return (
    <Link to={`/jobs/${j.id}`} className={cls('pd-jobrow', active && 'is-active')} aria-current={active ? 'page' : undefined}>
      <div className="pd-jobrow__main">
        <strong>{j.customer.name}</strong>
        <p>{j.service}</p>
      </div>
      <div className="pd-jobrow__side">
        <Money kobo={owes ? j.balanceKobo : j.totalKobo} size="md" />
        <span className="pd-hint">{owes ? 'left to pay' : 'total'}</span>
        {j.readyToStart ? <ReadyBadge /> : <JobStatusPill status={j.status} />}
      </div>
    </Link>
  );
}

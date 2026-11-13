import type { JobSummary } from '../../contract/contract';
import { Button } from '../../ui/primitives';
import { useRequestActions } from '../requests/useRequestActions';

/** The one next step for a job in a list, if there is one. */
export function JobFollowUp({ job }: { job: JobSummary }) {
  const a = useRequestActions();
  if (job.status === 'CANCELLED') return null;
  const r = job.openRequest;
  if (r?.status === 'SENT') {
    return <Button variant="line" busy={a.shareAgain.isPending && a.shareAgain.variables?.request.id === r.id}
      onClick={() => a.shareAgain.mutate({ request: r, job })}>Show payment details</Button>;
  }
  if (r && (r.status === 'DRAFT' || r.status === 'SCHEDULED')) {
    return <Button busy={a.send.isPending && a.send.variables === r.id} onClick={() => a.send.mutate(r.id)}>Get payment details</Button>;
  }
  if (!r && BigInt(job.balanceKobo) > 0n) {
    return <Button variant="line" busy={a.balance.isPending && a.balance.variables === job.id} onClick={() => a.balance.mutate(job.id)}>
      {BigInt(job.paidKobo) === 0n ? 'Get payment details' : 'Get balance details'}</Button>;
  }
  return null;
}

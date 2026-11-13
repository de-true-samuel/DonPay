import type { JobDetail } from '../contract/contract';
import { KIND_LABEL } from './labels';
import { formatNaira } from './money';

export interface TimelineItem {
  id: string;
  at: string;
  kind: 'job' | 'sent' | 'reminder' | 'expired' | 'cancelled' | 'payment';
  label: string;
  detail?: string;
  amountKobo?: string;
  paymentId?: string;
  trust?: 'verified' | 'manual' | 'simulated';
}

/** One chronological story of a job: requests and payments merged, newest first. */
export function buildJobTimeline(j: JobDetail): TimelineItem[] {
  const out: TimelineItem[] = [{ id: 'job', at: j.createdAt, kind: 'job', label: 'Job created' }];
  for (const r of j.requests) {
    const k = KIND_LABEL[r.kind];
    if (r.sentAt) out.push({ id: `sent-${r.id}`, at: r.sentAt, kind: 'sent', label: `${k} details created`, amountKobo: r.amountKobo });
    else if (r.status === 'SCHEDULED' && r.scheduledFor) out.push({ id: `rem-${r.id}`, at: r.scheduledFor, kind: 'reminder', label: `Reminder set for ${k.toLowerCase()}`, amountKobo: r.amountKobo });
    if (r.status === 'EXPIRED' && r.expiresAt) out.push({ id: `exp-${r.id}`, at: r.expiresAt, kind: 'expired', label: `${k} request expired`, amountKobo: r.amountKobo });
    if (r.status === 'CANCELLED') out.push({ id: `can-${r.id}`, at: r.sentAt ?? r.createdAt, kind: 'cancelled', label: `${k} request cancelled`, amountKobo: r.amountKobo });
  }
  for (const p of j.payments) {
    const req = j.requests.find((r) => r.id === p.requestId);
    const manual = p.source === 'MANUAL';
    out.push({
      id: `pay-${p.id}`, at: p.receivedAt, kind: 'payment', paymentId: p.id, amountKobo: p.amountKobo,
      trust: manual ? 'manual' : p.payerDetailsSimulated ? 'simulated' : 'verified',
      label: manual ? `${formatNaira(p.amountKobo, 'auto')} recorded by you` : `${req ? KIND_LABEL[req.kind] : 'Payment'} received`,
      detail: manual ? p.note ?? undefined : p.payerName ? `from ${p.payerName}` : undefined,
    });
  }
  if (j.cancelledAt) out.push({ id: 'job-cancelled', at: j.cancelledAt, kind: 'cancelled', label: 'Job cancelled' });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === 'payment' ? -1 : 1));
}

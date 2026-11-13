import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { JobSummary, PaymentRequest } from '../../contract/contract';
import { KIND_LABEL } from '../../lib/labels';
import { MOCK, SIMULATE } from '../../config';
import { lagosLocalToIso, formatDateTime, nowLagosLocal, timeAgo, tomorrowLagosLocal } from '../../lib/time';
import { CountdownRing } from '../../ui/CountdownRing';
import { Dialog } from '../../ui/Dialog';
import { Button, TextField } from '../../ui/primitives';
import { StatusPill } from '../../ui/Trust';
import { TicketCard } from '../../ui/TicketCard';
import { useToast } from '../../ui/Toast';
import { useCopiedAt } from './copyTracker';
import { useRequestActions } from './useRequestActions';

export { KIND_LABEL };

function statusLine(r: PaymentRequest, copiedAt: string | null): string {
  switch (r.status) {
    case 'DRAFT': return 'details not created yet';
    case 'SCHEDULED': return r.scheduledFor ? `reminder ${formatDateTime(r.scheduledFor)}` : 'reminder set';
    case 'SENT': {
      const live = r.sentAt ? `created ${timeAgo(r.sentAt)}` : 'active';
      const copy = copiedAt ? `copied ${timeAgo(copiedAt)}` : 'not copied yet';
      return `${live} · ${copy}`;
    }
    case 'PAID': return r.paidAt ? `paid ${timeAgo(r.paidAt)}` : 'paid';
    case 'EXPIRED': return r.expiresAt ? `expired ${timeAgo(r.expiresAt)}` : 'expired';
    default: return 'cancelled';
  }
}

/** One payment request as a ticket, with the actions that make sense for its status. */
export function RequestCard({ request: r, job, linkToJob }: { request: PaymentRequest; job: JobSummary; linkToJob?: boolean }) {
  const a = useRequestActions();
  const qc = useQueryClient();
  const toast = useToast();
  const copiedAt = useCopiedAt(r.id);
  const [remindOpen, setRemindOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const busy = (m: { isPending: boolean; variables?: unknown }) => m.isPending && m.variables === r.id;
  const heading = `${job.customer.name} · ${job.service}`;

  return (
    <>
      <TicketCard
        title={linkToJob ? <Link to={`/jobs/${job.id}`} className="pd-plainlink">{heading}</Link> : heading}
        subtitle={`${KIND_LABEL[r.kind]} · ${statusLine(r, copiedAt)}`}
        amountKobo={r.amountKobo}
        status={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <StatusPill status={r.status} />
            {r.status === 'SENT' && r.customerClaimedPaidAt && (
              <span
                className="pd-trust"
                style={{
                  background: '#FEF08A',
                  color: '#854D0E',
                  border: '1px solid #FDE047',
                  fontWeight: 600,
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 999,
                }}
              >
                Customer says paid ({timeAgo(r.customerClaimedPaidAt)})
              </span>
            )}
          </div>
        }
        aside={r.status === 'SENT' && r.sentAt && r.expiresAt ? <CountdownRing sentAt={r.sentAt} expiresAt={r.expiresAt} /> : undefined}
        footer={
          <div className="pd-actions">
            {(r.status === 'DRAFT' || r.status === 'SCHEDULED') && (
              <Button busy={busy(a.send)} onClick={() => a.send.mutate(r.id)}>Get payment details</Button>
            )}
            {r.status === 'DRAFT' && <Button variant="line" onClick={() => setRemindOpen(true)}>Remind me later</Button>}
            {r.status === 'SENT' && (
              <Button variant="line" busy={a.shareAgain.isPending && a.shareAgain.variables?.request.id === r.id}
                onClick={() => a.shareAgain.mutate({ request: r, job })}>Copy details again</Button>
            )}
            {r.status === 'SENT' && r.customerClaimedPaidAt && (
              <Button
                variant="line"
                onClick={() => {
                  void qc.invalidateQueries({ queryKey: ['today'] });
                  void qc.invalidateQueries({ queryKey: ['jobs'] });
                  void qc.invalidateQueries({ queryKey: ['job', job.id] });
                  toast.info('Checking with bank for payments…');
                }}
              >
                Check now
              </Button>
            )}
            {r.status === 'SENT' && SIMULATE && (
              <Button variant="quiet" busy={busy(a.simulate)} onClick={() => a.simulate.mutate(r.id)}>Simulate payment</Button>
            )}
            {r.status === 'SENT' && MOCK && (
              <Button variant="quiet" busy={a.simulateWrong.isPending && a.simulateWrong.variables?.requestId === r.id}
                onClick={() => a.simulateWrong.mutate({ requestId: r.id, amountKobo: (BigInt(r.amountKobo) > 100n ? BigInt(r.amountKobo) - 100n : 1n).toString() })}>Wrong amount (demo)</Button>
            )}
            {r.status === 'SENT' && MOCK && (
              <Button variant="quiet" busy={busy(a.expire)} onClick={() => a.expire.mutate(r.id)}>Expire now (demo)</Button>
            )}
            {r.status === 'EXPIRED' && <Button busy={busy(a.resend)} onClick={() => a.resend.mutate(r.id)}>Get new details</Button>}
            {['DRAFT', 'SCHEDULED', 'SENT'].includes(r.status) && (
              <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel</Button>
            )}
          </div>
        }
      />
      <RemindDialog open={remindOpen} onClose={() => setRemindOpen(false)} busy={busy(a.schedule)}
        onSubmit={(at) => a.schedule.mutate({ requestId: r.id, at }, { onSuccess: () => setRemindOpen(false) })} />
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this request?">
        <p className="pd-lede">
          {r.status === 'SENT'
            ? `If ${job.customer.name} already has these details, a payment may still arrive. It will show in Needs review.`
            : `${job.customer.name} won’t be asked to pay this one. You can get new payment details any time.`}
        </p>
        <div className="pd-actions">
          <Button variant="danger" busy={busy(a.cancel)}
            onClick={() => a.cancel.mutate(r.id, { onSuccess: () => setCancelOpen(false) })}>Cancel request</Button>
          <Button variant="quiet" onClick={() => setCancelOpen(false)}>Keep it</Button>
        </div>
      </Dialog>
    </>
  );
}

function RemindDialog({ open, onClose, onSubmit, busy }: {
  open: boolean; onClose: () => void; onSubmit: (iso: string) => void; busy: boolean;
}) {
  const [value, setValue] = useState(tomorrowLagosLocal(9));
  const iso = value ? lagosLocalToIso(value) : '';
  const past = !value || Date.parse(iso) <= Date.now();
  return (
    <Dialog open={open} onClose={onClose} title="Remind me to get payment details">
      <p className="pd-lede">Paidar reminds you on Telegram at this time. The payment account is only created when you get the details, so the countdown starts then.</p>
      <TextField label="Remind me at (Lagos time)" type="datetime-local" value={value} min={nowLagosLocal(1)}
        onChange={(e) => setValue(e.target.value)} error={value && past ? 'Pick a time in the future' : undefined} />
      <div className="pd-actions">
        <Button busy={busy} disabled={past} onClick={() => onSubmit(iso)}>Set reminder</Button>
        <Button variant="quiet" onClick={onClose}>Not now</Button>
      </div>
    </Dialog>
  );
}

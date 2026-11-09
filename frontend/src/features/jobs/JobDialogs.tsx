import { useState } from 'react';
import type { FormEvent } from 'react';
import { describeError } from '../../api/errors';
import type { JobDetail, PatchJobBody, ReadyRule } from '../../contract/contract';
import { READY_RULE } from '../../lib/labels';
import { formatNaira, parseNairaInput } from '../../lib/money';
import { isoToLagosDate, lagosDateToIso, lagosLocalToIso, nowLagosLocal } from '../../lib/time';
import { Dialog } from '../../ui/Dialog';
import { Banner, Button, ChoiceCards, TextField } from '../../ui/primitives';
import { useJobActions } from './useJobActions';

/* Each form is mounted only while its dialog is open, so it starts fresh every time. */

export function EditJobDialog({ job, open, onClose }: { job: JobDetail; open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Edit job"><EditForm job={job} onDone={onClose} /></Dialog>;
}

function EditForm({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const act = useJobActions(job.id);
  const [service, setService] = useState(job.service);
  const [notes, setNotes] = useState(job.notes ?? '');
  const [rule, setRule] = useState<ReadyRule>(job.readyRule);
  const oldDue = job.balanceDueAt ? isoToLagosDate(job.balanceDueAt) : '';
  const [due, setDue] = useState(oldDue);
  const err = describeError(act.update.error);
  const deposit = job.plan === 'DEPOSIT_BALANCE';

  const changes: PatchJobBody = {};
  if (service.trim() !== job.service) changes.service = service.trim();
  if ((notes.trim() || null) !== job.notes) changes.notes = notes.trim() || null;
  if (rule !== job.readyRule) changes.readyRule = rule;
  if (deposit && due !== oldDue) changes.balanceDueAt = due ? lagosDateToIso(due) : null;
  const dirty = Object.keys(changes).length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (dirty && service.trim()) act.update.mutate(changes, { onSuccess: onDone });
  }
  return (
    <form className="pd-stack" onSubmit={submit} noValidate>
      <TextField label="Service" value={service} maxLength={120} onChange={(e) => setService(e.target.value)}
        error={err.fieldErrors?.service?.[0] ?? (!service.trim() ? 'Describe the service' : undefined)} />
      <div className="pd-field">
        <label className="pd-label" htmlFor="pd-notes">Notes (only you see these)</label>
        <textarea id="pd-notes" className="pd-input pd-input--area" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {deposit && (
        <TextField label="Balance due" type="date" value={due} onChange={(e) => setDue(e.target.value)}
          error={err.fieldErrors?.balanceDueAt?.[0]} hint="Shown on Today when it’s due. Leave empty for no date." />
      )}
      <ChoiceCards legend="Ready to start" value={rule} onChange={setRule}
        options={(Object.keys(READY_RULE) as ReadyRule[]).map((v) => ({ value: v, ...READY_RULE[v] }))} />
      {act.update.isError && !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>}
      <div className="pd-actions">
        <Button type="submit" busy={act.update.isPending} disabled={!dirty || !service.trim()}>Save changes</Button>
        <Button type="button" variant="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function ManualPaymentDialog({ job, open, onClose }: { job: JobDetail; open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Record a payment"><ManualForm job={job} onDone={onClose} /></Dialog>;
}

function ManualForm({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const act = useJobActions(job.id);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [at, setAt] = useState(nowLagosLocal());
  const [tried, setTried] = useState(false);
  const err = describeError(act.manual.error);
  const kobo = parseNairaInput(amount);
  const valid = !!kobo && BigInt(kobo) > 0n;
  const future = !!at && Date.parse(lagosLocalToIso(at)) > Date.now() + 60_000;
  const owed = BigInt(job.balanceKobo);
  const more = valid && owed > 0n && BigInt(kobo!) > owed;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!valid || future) return;
    act.manual.mutate(
      { amountKobo: kobo!, note: note.trim() || undefined, receivedAt: at ? lagosLocalToIso(at) : undefined },
      { onSuccess: onDone },
    );
  }
  return (
    <form className="pd-stack" onSubmit={submit} noValidate>
      <p className="pd-lede">
        Use this for cash, or a transfer made outside Paidar. It counts toward what’s paid, but it’s marked <strong>Not verified</strong> and never makes the job “Ready to start”.
      </p>
      <TextField label="Amount received (₦)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
        error={err.fieldErrors?.amountKobo?.[0] ?? (tried && !valid ? 'Enter an amount like 10,000 or 10k' : undefined)}
        hint={valid ? (more ? `${formatNaira(kobo!)} is more than the ${formatNaira(job.balanceKobo)} still owed.` : formatNaira(kobo!)) : undefined} />
      <TextField label="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)}
        placeholder="Cash at the fitting" error={err.fieldErrors?.note?.[0]} />
      <TextField label="When did you receive it? (Lagos time)" type="datetime-local" value={at} max={nowLagosLocal()}
        onChange={(e) => setAt(e.target.value)} error={err.fieldErrors?.receivedAt?.[0] ?? (future ? 'The time can’t be in the future' : undefined)} />
      {act.manual.isError && !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>}
      <div className="pd-actions">
        <Button type="submit" busy={act.manual.isPending}>Record payment</Button>
        <Button type="button" variant="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function CancelJobDialog({ job, open, onClose }: { job: JobDetail; open: boolean; onClose: () => void }) {
  const act = useJobActions(job.id);
  return (
    <Dialog open={open} onClose={onClose} title="Cancel this job?">
      <p className="pd-lede">
        Any open payment request for {job.customer.name} is cancelled too. Payments you’ve already received stay on record.
      </p>
      {act.cancel.isError && <Banner tone="bad">{describeError(act.cancel.error).message}</Banner>}
      <div className="pd-actions">
        <Button variant="danger" busy={act.cancel.isPending} onClick={() => act.cancel.mutate(undefined, { onSuccess: onClose })}>Cancel job</Button>
        <Button variant="quiet" onClick={onClose}>Keep it</Button>
      </div>
    </Dialog>
  );
}

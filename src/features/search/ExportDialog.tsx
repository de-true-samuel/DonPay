import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { describeError } from '../../api/errors';
import { exportApi } from '../../api/endpoints';
import { exportFilename } from '../../lib/filters';
import { saveBlob } from '../../lib/download';
import { isoToLagosDate, lagosParts } from '../../lib/time';
import { Dialog } from '../../ui/Dialog';
import { Banner, Button, TextField } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Export payments"><ExportForm onDone={onClose} /></Dialog>;
}

function ExportForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const today = isoToLagosDate(new Date().toISOString());
  const { y, m } = lagosParts();
  const [from, setFrom] = useState(`${y}-${String(m + 1).padStart(2, '0')}-01`);
  const [to, setTo] = useState(today);
  const bad = !!from && !!to && from > to;

  const run = useMutation({
    mutationFn: () => exportApi.csv({ from: from || undefined, to: to || undefined }),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename || exportFilename(from, to));
      toast.success('Downloaded. Open it in Excel or Google Sheets.');
      onDone();
    },
  });

  function submit(e: FormEvent) { e.preventDefault(); if (!bad) run.mutate(); }
  return (
    <form className="pd-stack" onSubmit={submit} noValidate>
      <p className="pd-lede">One row per payment, with the customer, service, amount, how it was paid and the job’s balance. Good for your accountant.</p>
      <TextField label="From" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
      <TextField label="To" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)}
        error={bad ? 'This date is before the start date' : undefined} />
      {run.isError && <Banner tone="bad">{describeError(run.error).message}</Banner>}
      <div className="pd-actions">
        <Button type="submit" busy={run.isPending} disabled={bad}>Download CSV</Button>
        <Button type="button" variant="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

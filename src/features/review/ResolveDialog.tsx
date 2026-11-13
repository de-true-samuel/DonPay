import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../../api/errors';
import { jobsApi, reviewApi } from '../../api/endpoints';
import type { ReviewItem } from '../../contract/contract';
import { buildResolution, RESOLUTIONS, REVIEW_LABEL } from '../../lib/review';
import { formatNaira } from '../../lib/money';
import { Dialog } from '../../ui/Dialog';
import { Banner, Button, ChoiceCards } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

export function ResolveDialog({ item, open, onClose }: { item: ReviewItem; open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title={REVIEW_LABEL[item.kind]}><ResolveForm item={item} onDone={onClose} /></Dialog>;
}

function ResolveForm({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const options = RESOLUTIONS[item.kind];
  const [choice, setChoice] = useState(options[0].value);
  const [note, setNote] = useState('');
  const [alsoCancel, setAlsoCancel] = useState(true);

  // A late payment while a replacement request is open: offer to cancel the replacement in the same step.
  const job = useQuery({
    queryKey: ['job', item.jobId], queryFn: () => jobsApi.get(item.jobId!),
    enabled: item.kind === 'PAID_AFTER_EXPIRY' && !!item.jobId,
  });
  const replacement = job.data?.openRequest && job.data.openRequest.id !== item.requestId ? job.data.openRequest : null;
  const picked = options.find((o) => o.value === choice)!;
  const needsNote = choice === 'other';

  const resolve = useMutation({
    mutationFn: () => reviewApi.resolve(item.id, {
      resolution: buildResolution(picked.title, note),
      ...(replacement && choice === 'keep' && alsoCancel ? { cancelRequestId: replacement.id } : {}),
    }),
    onSuccess: () => {
      for (const k of ['today', 'review', 'job', 'jobs', 'search']) void qc.invalidateQueries({ queryKey: [k] });
      toast.success('Marked as dealt with.');
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!needsNote || note.trim()) resolve.mutate();
  }

  return (
    <form className="pd-stack" onSubmit={submit} noValidate>
      <p className="pd-lede">{item.message}</p>
      {item.jobId && <p className="pd-hint"><Link to={`/jobs/${item.jobId}`} onClick={onDone}>Open the job</Link> to see the payments.</p>}
      <ChoiceCards legend="What did you do?" value={choice} onChange={setChoice}
        options={options.map((o) => ({ value: o.value, title: o.title, text: o.text }))} />
      <div className="pd-field">
        <label className="pd-label" htmlFor="pd-res-note">{needsNote ? 'Note (required)' : 'Note (optional)'}</label>
        <textarea id="pd-res-note" className="pd-input pd-input--area" rows={2} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="For your own records" />
        {needsNote && <p className="pd-hint">A short note is needed when it’s something else.</p>}
      </div>
      {replacement && choice === 'keep' && (
        <label className="pd-check">
          <input type="checkbox" checked={alsoCancel} onChange={(e) => setAlsoCancel(e.target.checked)} />
          <span>Cancel the open {formatNaira(replacement.amountKobo)} request too, since this one was paid</span>
        </label>
      )}
      <p className="pd-hint">Paidar records payments and creates accounts. It never moves money out of your bank accounts.</p>
      {resolve.isError && <Banner tone="bad">{describeError(resolve.error).message}</Banner>}
      <div className="pd-actions">
        <Button type="submit" busy={resolve.isPending} disabled={needsNote && !note.trim()}>Resolve</Button>
        <Button type="button" variant="quiet" onClick={onDone}>Not now</Button>
      </div>
    </form>
  );
}

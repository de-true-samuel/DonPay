import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { jobsApi } from '../api/endpoints';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { isoToLagosDate, lagosDateToIso } from '../lib/time';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';

export function EditJobPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({ queryKey: ['job', id], queryFn: () => jobsApi.get(id) });
  useDocumentTitle(q.data ? `Edit · ${q.data.service}` : 'Edit job');

  const j = q.data;
  const [service, setService] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const curService = service ?? j?.service ?? '';
  const curDue = due ?? (j?.balanceDueAt ? isoToLagosDate(j.balanceDueAt) : '');
  const curNotes = notes ?? j?.notes ?? '';

  const dirty = !!j && (curService !== j.service || curDue !== (j.balanceDueAt ? isoToLagosDate(j.balanceDueAt) : '') || curNotes !== (j.notes ?? ''));
  useUnsavedGuard(dirty);

  const saveMut = useMutation({
    mutationFn: () =>
      jobsApi.update(id, {
        service: curService.trim(),
        notes: curNotes.trim() || null,
        balanceDueAt: curDue ? lagosDateToIso(curDue) : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job', id] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Job updated.');
      nav(`/app/jobs/${id}`);
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (q.isPending || !j) return <div className="pf-card"><p>Loading job…</p></div>;

  const hasVerifiedPayment = BigInt(j.verifiedPaidKobo) > 0n;
  const isTerminal = j.status === 'CANCELLED';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || !curService.trim()) return;
    saveMut.mutate();
  }

  return (
    <div style={{ maxWidth: 640 }} data-flow-id="JBE-00">
      <div className="pf-page-head">
        <div>
          <h1>Edit job</h1>
          <p className="pf-page-head__sub">{j.customer.name}</p>
        </div>
        <Link to={`/app/jobs/${j.id}`} className="pf-btn pf-btn--secondary" data-flow-id="JBE-02">Cancel</Link>
      </div>

      <form className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }} onSubmit={onSubmit}>
        {/* Immutable Client */}
        <div style={{ background: 'var(--bg-surface-subtle)', padding: 12, borderRadius: 9, border: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} data-flow-id="JBE-03">
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Client (locked after creation)</div>
            <strong>{j.customer.name}</strong>
          </div>
          <span title="Client cannot be changed after creation. Duplicate into a new job instead." style={{ color: 'var(--text-muted)' }}>
            <Icon name="lock" size={16} />
          </span>
        </div>

        <div>
          <label htmlFor="jbe-service" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Description</label>
          <textarea
            id="jbe-service"
            rows={3}
            value={curService}
            onChange={(e) => setService(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
          />
        </div>

        <div>
          <label htmlFor="jbe-due" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Due date</label>
          <input
            id="jbe-due"
            type="date"
            disabled={isTerminal}
            value={curDue}
            onChange={(e) => setDue(e.target.value)}
            style={{ height: 44, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
          />
        </div>

        {/* Locked Amount when verified payment exists */}
        <div style={{ background: 'var(--bg-surface-subtle)', padding: 12, borderRadius: 9, border: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Agreed total</div>
            <strong>{formatNaira(j.totalKobo)}</strong>
          </div>
          {hasVerifiedPayment && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
              <Icon name="lock" size={14} /> Locked (payment verified)
            </span>
          )}
        </div>

        <div>
          <label htmlFor="jbe-notes" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Private notes</label>
          <textarea
            id="jbe-notes"
            rows={2}
            value={curNotes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
          />
        </div>

        <button type="submit" disabled={!dirty || saveMut.isPending} className="pf-btn pf-btn--primary" data-flow-id="JBE-01">
          {saveMut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
        </button>
      </form>
    </div>
  );
}

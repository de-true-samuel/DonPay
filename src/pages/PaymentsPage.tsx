import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reviewApi, todayApi } from '../api/endpoints';
import type { JobSummary, Payment, PaymentRequest, ReviewItem } from '../contract/contract';
import { ResolveDialog } from '../features/review/ResolveDialog';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { REVIEW_LABEL } from '../lib/review';
import { formatTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { PaymentStatusChip } from '../ui/StatusChip';
import { useToast } from '../ui/Toast';

type TabKey = 'attention' | 'awaiting' | 'received' | 'all';

interface LedgerRow {
  id: string;
  dateIso: string;
  clientName: string;
  jobId: string;
  jobTitle: string;
  amountKobo: string;
  status: 'awaiting_payment' | 'paid' | 'under_review' | 'cancelled';
  paidBy: string;
  reference: string;
  payLink?: string;
  token?: string;
  requestId?: string;
  kindLabel: string;
  payment?: Payment;
  request?: PaymentRequest;
}

export function PaymentsPage() {
  useDocumentTitle('Payments');
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const tab = (params.get('tab') as TabKey) || 'all';
  const selectedId = params.get('payment') || '';
  const [search, setSearch] = useState('');
  const [attentionState, setAttentionState] = useState<'open' | 'resolved'>('open');
  const [resolving, setResolving] = useState<ReviewItem | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  const { data: today } = useQuery({
    queryKey: ['today'],
    queryFn: () => todayApi.get(),
  });

  const { data: reviewData } = useQuery({
    queryKey: ['review', attentionState],
    queryFn: () => reviewApi.list({ state: attentionState, limit: 50 }),
  });

  const checkNowMut = useMutation({
    mutationFn: async (_requestId: string) => {
      await qc.invalidateQueries({ queryKey: ['today'] });
    },
    onSuccess: () => {
      toast.info('Checked payment status.');
    },
    onError: (err) => toast.error((err as Error).message || 'Could not check payment right now.'),
  });

  const rows = useMemo<LedgerRow[]>(() => {
    if (!today) return [];
    const list: LedgerRow[] = [];

    for (const item of today.justPaid) {
      const token = item.payment.requestId ? undefined : undefined;
      list.push({
        id: item.payment.id,
        dateIso: item.payment.receivedAt,
        clientName: item.job.customer.name,
        jobId: item.job.id,
        jobTitle: item.job.service,
        amountKobo: item.payment.amountKobo,
        status: 'paid',
        paidBy: item.payment.payerName ? `${item.payment.payerName}${item.payment.payerBank ? ` · ${item.payment.payerBank}` : ''}` : '—',
        reference: item.payment.id,
        token: item.job.openRequest?.payLink.split('/').pop() ?? token,
        requestId: item.payment.requestId ?? undefined,
        kindLabel: item.payment.source === 'KORA_VERIFIED' ? 'Verified' : 'Manual',
        payment: item.payment,
      });
    }

    const addRequest = (r: PaymentRequest, j: JobSummary) => {
      list.push({
        id: r.id,
        dateIso: r.sentAt ?? r.createdAt,
        clientName: j.customer.name,
        jobId: j.id,
        jobTitle: j.service,
        amountKobo: r.amountKobo,
        status: r.status === 'CANCELLED' ? 'cancelled' : 'awaiting_payment',
        paidBy: '—',
        reference: r.id,
        payLink: r.payLink,
        token: r.payLink.split('/').pop(),
        requestId: r.id,
        kindLabel: r.kind,
        request: r,
      });
    };

    for (const w of today.waiting) addRequest(w.request, w.job);
    for (const e of today.expired) addRequest(e.request, e.job);

    return list.sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso));
  }, [today]);

  const receivedTotal = useMemo(
    () => (today?.justPaid ?? []).reduce((s, x) => s + BigInt(x.payment.amountKobo), 0n),
    [today],
  );
  const awaitingTotal = useMemo(
    () => (today?.waiting ?? []).reduce((s, x) => s + BigInt(x.request.amountKobo), 0n),
    [today],
  );
  const attentionCount = today?.counts.needsReview ?? 0;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === 'awaiting' && r.status !== 'awaiting_payment') return false;
      if (tab === 'received' && r.status !== 'paid') return false;
      if (!q) return true;
      return (
        r.clientName.toLowerCase().includes(q) ||
        r.jobTitle.toLowerCase().includes(q) ||
        r.paidBy.toLowerCase().includes(q) ||
        r.reference.toLowerCase().includes(q)
      );
    });
  }, [rows, tab, search]);

  const selectedRow = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  function setTab(next: TabKey) {
    const sp = new URLSearchParams(params);
    sp.set('tab', next);
    sp.delete('payment');
    setParams(sp);
  }

  function openDrawer(id: string) {
    const sp = new URLSearchParams(params);
    sp.set('payment', id);
    setParams(sp);
  }

  function closeDrawer() {
    const sp = new URLSearchParams(params);
    sp.delete('payment');
    setParams(sp);
  }

  useEffect(() => {
    if (!selectedRow) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function copyValue(val: string, label: string) {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedRef(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div data-flow-id="PMT-00">
      <div className="pf-page-head">
        <div>
          <h1>Payments</h1>
          <p className="pf-page-head__sub">Verified receipts, open payment requests, and items needing review.</p>
        </div>
        <Link to="/app/new" className="pf-btn pf-btn--primary">
          <Icon name="plus" size={16} />
          <span>New request</span>
        </Link>
      </div>

      {/* Summary Row (PMT-01) */}
      <div className="pf-metrics" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <button type="button" className="pf-metric" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setTab('received')}>
          <div className="pf-metric__top">
            <span>Verified received</span>
            <Icon name="shield" size={16} />
          </div>
          <div className="pf-metric__val">{formatNaira(receivedTotal.toString())}</div>
          <div className="pf-metric__sub">{today?.justPaid.length ?? 0} verified payments</div>
        </button>

        <button type="button" className="pf-metric" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setTab('awaiting')}>
          <div className="pf-metric__top">
            <span>Awaiting payment</span>
            <Icon name="clock" size={16} />
          </div>
          <div className="pf-metric__val">{formatNaira(awaitingTotal.toString())}</div>
          <div className="pf-metric__sub">{today?.waiting.length ?? 0} open requests</div>
        </button>

        <button type="button" className="pf-metric" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setTab('attention')}>
          <div className="pf-metric__top">
            <span>Needs attention</span>
            <Icon name="alert" size={16} />
          </div>
          <div className={`pf-metric__val ${attentionCount > 0 ? 'pf-metric__val--danger' : ''}`}>
            {attentionCount}
          </div>
          <div className="pf-metric__sub">{attentionCount > 0 ? 'Requires your review' : 'All clear'}</div>
        </button>
      </div>

      {/* Tabs (PMT-02) */}
      <div className="pf-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'attention'} className={`pf-tab-btn ${tab === 'attention' ? 'is-active' : ''}`} onClick={() => setTab('attention')}>
          <span>Needs attention</span>
          {attentionCount > 0 && (
            <span style={{ background: 'var(--status-danger)', color: '#FFFFFF', borderRadius: 999, padding: '1px 7px', fontSize: 11 }}>
              {attentionCount}
            </span>
          )}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'awaiting'} className={`pf-tab-btn ${tab === 'awaiting' ? 'is-active' : ''}`} onClick={() => setTab('awaiting')}>
          Awaiting
        </button>
        <button type="button" role="tab" aria-selected={tab === 'received'} className={`pf-tab-btn ${tab === 'received' ? 'is-active' : ''}`} onClick={() => setTab('received')}>
          Received
        </button>
        <button type="button" role="tab" aria-selected={tab === 'all'} className={`pf-tab-btn ${tab === 'all' ? 'is-active' : ''}`} onClick={() => setTab('all')}>
          All
        </button>
      </div>

      {/* Needs Attention Workspace (ATT-01 to ATT-04) */}
      {tab === 'attention' ? (
        <section data-flow-id="ATT-00">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button type="button" className={`pf-btn pf-btn--sm ${attentionState === 'open' ? 'pf-btn--primary' : 'pf-btn--secondary'}`} onClick={() => setAttentionState('open')} data-flow-id="ATT-01">
              Open
            </button>
            <button type="button" className={`pf-btn pf-btn--sm ${attentionState === 'resolved' ? 'pf-btn--primary' : 'pf-btn--secondary'}`} onClick={() => setAttentionState('resolved')}>
              Handled
            </button>
          </div>

          {(reviewData?.items.length ?? 0) === 0 ? (
            <div className="pf-card" style={{ textAlign: 'center', padding: 36 }} data-flow-id="ATT-04">
              <p style={{ color: 'var(--text-secondary)' }}>Nothing needs your attention.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {reviewData!.items.map((item) => (
                <div key={item.id} className="pf-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{REVIEW_LABEL[item.kind]}</div>
                    <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 4 }}>{item.message}</p>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {formatTime(item.createdAt)}
                      {item.resolution ? ` · Handled: ${item.resolution}` : ''}
                    </span>
                  </div>
                  {!item.resolvedAt && (
                    <button type="button" className="pf-btn pf-btn--sm pf-btn--primary" onClick={() => setResolving(item)} data-flow-id="ATT-02">
                      Resolve
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {resolving && <ResolveDialog item={resolving} open={!!resolving} onClose={() => setResolving(null)} />}
        </section>
      ) : (
        /* Ledger (PMT-03 to PMT-11) */
        <section>
          <div style={{ marginBottom: 14 }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client, job, payer name, or reference…"
              aria-label="Search payments"
              data-flow-id="PMT-03"
              style={{
                width: '100%', maxWidth: 380, height: 42, padding: '0 14px',
                borderRadius: 9, border: '1px solid var(--border-strong)', background: '#FFFFFF',
              }}
            />
          </div>

          {filteredRows.length === 0 ? (
            <div className="pf-card" style={{ textAlign: 'center', padding: 36 }} data-flow-id="PMT-11">
              <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                {tab === 'received' ? 'No verified payments yet.' : 'No payment records match.'}
              </p>
              <Link to="/app/new" className="pf-btn pf-btn--primary">Create a payment request</Link>
            </div>
          ) : (
            <>
              <div className="pf-card pf-table-wrap" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="pf-table" data-flow-id="PMT-06">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Client</th>
                      <th>Job</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th>Paid by</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={row.id} className="is-clickable" onClick={() => openDrawer(row.id)}>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{formatTime(row.dateIso)}</td>
                        <td style={{ fontWeight: 600 }}>{row.clientName}</td>
                        <td>{row.jobTitle}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatNaira(row.amountKobo)}</td>
                        <td><PaymentStatusChip status={row.status} /></td>
                        <td style={{ color: 'var(--text-secondary)' }}>{row.paidBy}</td>
                        <td className="pd-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.reference.slice(-8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pf-card-list">
                {filteredRows.map((row) => (
                  <div key={row.id} className="pf-card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => openDrawer(row.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong style={{ fontSize: 16 }}>{formatNaira(row.amountKobo)}</strong>
                      <PaymentStatusChip status={row.status} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{row.clientName}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{row.jobTitle}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{formatTime(row.dateIso)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* Payment Detail Drawer (PMT-12 to PMT-18) */}
      {selectedRow && (
        <div className="pf-drawer-backdrop" onClick={closeDrawer}>
          <aside className="pf-drawer" role="dialog" aria-modal="true" aria-label="Payment details" onClick={(e) => e.stopPropagation()} data-flow-id="PMT-12">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <PaymentStatusChip status={selectedRow.status} />
                <h2 style={{ fontSize: 26, marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>{formatNaira(selectedRow.amountKobo)}</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginTop: 2 }}>
                  {selectedRow.clientName} · {selectedRow.kindLabel}
                </p>
              </div>
              <button type="button" className="pf-icon-btn" onClick={closeDrawer} aria-label="Close drawer">
                <Icon name="x" size={20} />
              </button>
            </div>

            {selectedRow.status === 'paid' && (
              <div style={{ background: 'var(--status-success-tint)', color: 'var(--status-success)', padding: '10px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600 }}>
                Confirmed through the payment provider’s transaction records.
              </div>
            )}

            <div className="pf-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Timeline</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: '22px' }}>
                <li>Request created</li>
                <li>{selectedRow.request?.accountNumber ? 'Temporary account generated' : 'Account step'}</li>
                <li style={{ color: selectedRow.status === 'paid' ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {selectedRow.status === 'paid' ? `Verified (${formatTime(selectedRow.dateIso)})` : 'Awaiting verified transfer'}
                </li>
              </ul>
            </div>

            <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 10, columnGap: 12, margin: 0, fontSize: 13.5 }}>
              <dt style={{ color: 'var(--text-secondary)' }}>Job</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>
                <Link to={`/app/jobs/${selectedRow.jobId}`}>{selectedRow.jobTitle}</Link>
              </dd>
              <dt style={{ color: 'var(--text-secondary)' }}>Paid by</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{selectedRow.paidBy}</dd>
              <dt style={{ color: 'var(--text-secondary)' }}>Reference</dt>
              <dd style={{ margin: 0, textAlign: 'right', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="pd-mono" style={{ fontSize: 12 }}>{selectedRow.reference}</span>
                <button type="button" onClick={() => void copyValue(selectedRow.reference, 'Reference')} style={{ border: '1px solid var(--border-default)', background: 'var(--bg-surface-subtle)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>
                  {copiedRef ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </dl>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
              {selectedRow.status === 'awaiting_payment' && selectedRow.requestId && (
                <button type="button" className="pf-btn pf-btn--primary" disabled={checkNowMut.isPending} onClick={() => checkNowMut.mutate(selectedRow.requestId!)}>
                  {checkNowMut.isPending ? 'Checking…' : 'Check payment now'}
                </button>
              )}
              {selectedRow.payLink && selectedRow.status === 'awaiting_payment' && (
                <button type="button" className="pf-btn pf-btn--secondary" onClick={() => void copyValue(selectedRow.payLink!, 'Payment link')}>
                  Copy payment link
                </button>
              )}
              {selectedRow.status === 'paid' && selectedRow.token && (
                <Link to={`/receipt/${selectedRow.token}`} target="_blank" className="pf-btn pf-btn--primary">
                  View receipt
                </Link>
              )}
              <Link to={`/app/jobs/${selectedRow.jobId}`} className="pf-btn pf-btn--secondary">
                Open job
              </Link>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

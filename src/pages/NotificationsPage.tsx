import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi, todayApi } from '../api/endpoints';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatTime } from '../lib/time';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';

interface Notice {
  id: string;
  kind: 'paid' | 'claim' | 'review';
  title: string;
  body: string;
  at: string;
  link: string;
}

export function NotificationsPage() {
  useDocumentTitle('Notifications');
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  const { data: today } = useQuery({
    queryKey: ['today'],
    queryFn: () => todayApi.get(),
  });

  const notices = useMemo<Notice[]>(() => {
    if (!today) return [];
    const list: Notice[] = [];
    for (const p of today.justPaid) {
      list.push({
        id: `pay_${p.payment.id}`,
        kind: 'paid',
        title: `${formatNaira(p.payment.amountKobo)} verified from ${p.job.customer.name}`,
        body: `${p.job.service} is ready in your work queue.`,
        at: p.payment.receivedAt,
        link: `/app/payments?tab=received&payment=${p.payment.id}`,
      });
    }
    for (const w of today.waiting) {
      if (w.request.customerClaimedPaidAt) {
        list.push({
          id: `clm_${w.request.id}`,
          kind: 'claim',
          title: `${w.job.customer.name} tapped I've paid`,
          body: `${w.job.service} · awaiting bank verification.`,
          at: w.request.customerClaimedPaidAt,
          link: `/app/jobs/${w.job.id}#payments`,
        });
      }
    }
    for (const r of today.needsReview) {
      list.push({
        id: `rev_${r.id}`,
        kind: 'review',
        title: 'Payment needs attention',
        body: r.message,
        at: r.createdAt,
        link: '/app/payments?tab=attention',
      });
    }
    return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [today]);

  const visible = tab === 'unread' ? notices.filter((n) => !readIds.has(n.id)) : notices;

  function markAllRead() {
    setReadIds(new Set(notices.map((n) => n.id)));
    void notificationsApi.markAllRead().catch(() => { /* ignore in mock */ });
    toast.success('All notifications marked as read.');
  }

  function openNotice(n: Notice) {
    setReadIds((prev) => new Set(prev).add(n.id));
    nav(n.link);
  }

  return (
    <div data-flow-id="NTF-00">
      <div className="pf-page-head">
        <div>
          <h1>Notifications</h1>
          <p className="pf-page-head__sub">Payment alerts, job reminders, and items needing your review.</p>
        </div>
        {notices.length > 0 && (
          <button type="button" className="pf-btn pf-btn--secondary" onClick={markAllRead} data-flow-id="NTF-04">
            Mark all read
          </button>
        )}
      </div>

      <div className="pf-tabs" role="tablist" data-flow-id="NTF-01">
        <button type="button" role="tab" aria-selected={tab === 'all'} className={`pf-tab-btn ${tab === 'all' ? 'is-active' : ''}`} onClick={() => setTab('all')}>
          All
        </button>
        <button type="button" role="tab" aria-selected={tab === 'unread'} className={`pf-tab-btn ${tab === 'unread' ? 'is-active' : ''}`} onClick={() => setTab('unread')}>
          Unread
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="pf-card" style={{ textAlign: 'center', padding: 36 }} data-flow-id="NTF-06">
          <p style={{ color: 'var(--text-secondary)' }}>You’re all caught up.</p>
        </div>
      ) : (
        <div className="pf-card" style={{ padding: 0, overflow: 'hidden' }}>
          {visible.map((n) => {
            const unread = !readIds.has(n.id);
            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => openNotice(n)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openNotice(n); }}
                data-flow-id="NTF-02"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '14px 20px', borderBottom: '1px solid var(--border-default)', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8, height: 8, borderRadius: 999, marginTop: 9, flexShrink: 0,
                      background: unread ? 'var(--active-pill-bg)' : 'transparent',
                      border: unread ? '1px solid var(--volt-lo)' : 'none',
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className={`ob-status ob-status--${n.kind === 'paid' ? 'mint' : n.kind === 'claim' ? 'solar' : 'flare'}`}
                    style={{ padding: 6 }}
                  >
                    <Icon
                      name={n.kind === 'paid' ? 'shield' : n.kind === 'claim' ? 'radar' : 'alert'}
                      size={15}
                      pulse={n.kind === 'claim'}
                    />
                  </span>
                  <div>
                    <div style={{ fontWeight: unread ? 700 : 500, fontSize: 14, color: unread ? 'var(--ink-1)' : 'var(--ink-2)' }}>
                      {unread && <span className="pd-sr-only">Unread: </span>}
                      {n.title}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{n.body}</div>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatTime(n.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

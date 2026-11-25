import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { notificationsApi, todayApi } from '../api/endpoints';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira } from '../lib/money';
import { formatTime } from '../lib/time';
import { useToast } from '../ui/Toast';

interface Notice {
  id: string;
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
        title: `${formatNaira(p.payment.amountKobo)} verified from ${p.job.customer.name}`,
        body: `${p.job.service} is ready in your work queue.`,
        at: p.payment.receivedAt,
        link: `/app/payments?tab=received&payment=${p.payment.id}`,
      });
    }
    for (const r of today.needsReview) {
      list.push({
        id: `rev_${r.id}`,
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
                      width: 8, height: 8, borderRadius: 999, marginTop: 7, flexShrink: 0,
                      background: unread ? 'var(--action-primary)' : 'transparent',
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: unread ? 650 : 500, fontSize: 14 }}>{n.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{n.body}</div>
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

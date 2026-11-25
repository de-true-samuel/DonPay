import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { meApi } from '../api/endpoints';
import { api } from '../api/client';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import { API_URL } from '../config';
import type { ReadyRule } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { Icon } from '../ui/Icon';
import { Banner, Switch } from '../ui/primitives';
import { useToast } from '../ui/Toast';

type SectionKey = 'profile' | 'hours' | 'defaults' | 'notifications' | 'kora' | 'security' | 'data' | 'danger';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'profile', label: 'Business profile' },
  { key: 'hours', label: 'Working hours' },
  { key: 'defaults', label: 'Payment defaults' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'kora', label: 'Kora connection' },
  { key: 'security', label: 'Account & security' },
  { key: 'data', label: 'Data' },
  { key: 'danger', label: 'Danger zone' },
];

const DEFAULT_TEMPLATE = "Hi {client}, here's the payment link for {job} ({amount}): {link}";
const TEMPLATE_VARS = ['{client}', '{job}', '{amount}', '{link}', '{business}'];

const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { provider, signOut } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();

  const [section, setSection] = useState<SectionKey>('profile');

  // A. Business profile
  const [bizName, setBizName] = useState(provider?.businessName ?? '');
  const [phone, setPhone] = useState('');
  const [showPhone, setShowPhone] = useState(true);

  // B. Working hours
  const [days, setDays] = useState<Record<string, { on: boolean; start: string; end: string }>>({
    Mon: { on: true, start: '09:00', end: '17:00' },
    Tue: { on: true, start: '09:00', end: '17:00' },
    Wed: { on: true, start: '09:00', end: '17:00' },
    Thu: { on: true, start: '09:00', end: '17:00' },
    Fri: { on: true, start: '09:00', end: '17:00' },
    Sat: { on: false, start: '09:00', end: '17:00' },
    Sun: { on: false, start: '09:00', end: '17:00' },
  });

  // C. Payment defaults
  const [rule, setRule] = useState<ReadyRule>(provider?.defaultReadyRule ?? 'AFTER_DEPOSIT');
  const [depositPct, setDepositPct] = useState(50);
  const [feeBearer, setFeeBearer] = useState<'OWNER' | 'CLIENT'>('OWNER');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [templateErr, setTemplateErr] = useState('');

  // D. Notifications
  const [dueReminderDays, setDueReminderDays] = useState('1');
  const [digestOn, setDigestOn] = useState(provider?.digestTime != null);
  const [digestTime, setDigestTime] = useState(provider?.digestTime ?? '19:30');

  // E. Telegram / Kora
  const [waitingTg, setWaitingTg] = useState(false);

  // H. Danger zone
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const dirtyProfile = !!provider && bizName.trim() !== provider.businessName;
  useUnsavedGuard(dirtyProfile);

  const saveProfile = useMutation({
    mutationFn: () =>
      meApi.update({
        businessName: bizName.trim(),
        defaultReadyRule: rule,
        digestTime: digestOn ? digestTime : null,
      }),
    onSuccess: (p) => {
      qc.setQueryData(ME_KEY, p);
      toast.success('Settings saved.');
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  const linkTg = useMutation({
    mutationFn: meApi.telegramLink,
    onSuccess: (r) => {
      window.open(r.url, '_blank', 'noopener');
      setWaitingTg(true);
    },
  });

  const removeSampleMut = useMutation({
    mutationFn: () => api<{ deletedJobs: number }>('/api/me/sample-data', { method: 'DELETE' }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast.success(`Removed ${r.deletedJobs} sample item(s).`);
    },
    onError: () => toast.info('No sample records removed.'),
  });

  useEffect(() => {
    if (!waitingTg || provider?.telegramLinked) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ME_KEY }), 3000);
    return () => clearInterval(t);
  }, [waitingTg, provider?.telegramLinked, qc]);

  const weeklyHours = useMemo(() => {
    let mins = 0;
    for (const d of DAY_KEYS) {
      const s = days[d];
      if (!s.on) continue;
      const [sh, sm] = s.start.split(':').map(Number);
      const [eh, em] = s.end.split(':').map(Number);
      const diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff > 0) mins += diff;
    }
    return Math.round((mins / 60) * 10) / 10;
  }, [days]);

  if (!provider) return null;

  const previewAccountName = bizName.trim().replace(/[^a-zA-Z0-9 '&.-]/g, '').slice(0, 40) || provider.businessName;
  const webhookUrl = `${API_URL || window.location.origin}/webhooks/kora`;

  function insertVar(v: string) {
    setTemplate((t) => `${t} ${v}`.trim());
    setTemplateErr('');
  }

  function saveDefaults() {
    if (!template.includes('{link}')) {
      setTemplateErr('Your message must include {link}.');
      return;
    }
    setTemplateErr('');
    saveProfile.mutate();
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success('Webhook URL copied');
    } catch { /* ignore */ }
  }

  return (
    <div data-flow-id="SET-00">
      <div className="pf-page-head">
        <div>
          <h1>Settings</h1>
          <p className="pf-page-head__sub">Manage your business profile, working hours, payment defaults, and Kora connection.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, alignItems: 'start' }}>
        {/* Left Settings Navigation */}
        <nav className="pf-card" style={{ padding: 10, maxWidth: 280 }} aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: 0, cursor: 'pointer',
                fontSize: 13.5, fontWeight: 600,
                background: section === s.key ? 'var(--bg-selected)' : 'transparent',
                color: s.key === 'danger' ? 'var(--status-danger)' : section === s.key ? 'var(--action-primary)' : 'var(--text-primary)',
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Right Content Pane */}
        <div style={{ gridColumn: 'span 2', minWidth: 280 }}>
          {section === 'profile' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2>Business profile</h2>
              <div>
                <label htmlFor="set-biz" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Business name</label>
                <input
                  id="set-biz"
                  type="text"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  data-flow-id="SET-01"
                  style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Applies to new payment accounts. Links already shared keep the old name until they refresh.
                </p>
              </div>

              <div style={{ background: 'var(--bg-surface-subtle)', padding: 12, borderRadius: 9, border: '1px solid var(--border-default)' }} data-flow-id="SET-02">
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Live account-name preview</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>Account name: <strong>{previewAccountName}</strong></div>
              </div>

              <div>
                <label htmlFor="set-phone" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>WhatsApp / phone</label>
                <input
                  id="set-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0803 123 4567"
                  data-flow-id="SET-03"
                  style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                />
              </div>

              <Switch
                checked={showPhone}
                onChange={(v) => { setShowPhone(v); toast.success('Preference updated.'); }}
                label="Show my number on the payment page"
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }} data-flow-id="SET-06">
                <div style={{ background: 'var(--bg-surface-subtle)', padding: 10, borderRadius: 8 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Currency</div>
                  <strong>NGN (₦)</strong>
                </div>
                <div style={{ background: 'var(--bg-surface-subtle)', padding: 10, borderRadius: 8 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Timezone</div>
                  <strong>Africa/Lagos</strong>
                </div>
              </div>

              <button type="button" className="pf-btn pf-btn--primary" disabled={!dirtyProfile || saveProfile.isPending} onClick={() => saveProfile.mutate()}>
                {saveProfile.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}

          {section === 'hours' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2>Working hours</h2>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                Used by the Queue engine to flag At risk jobs when committed hours exceed capacity.
              </p>
              {DAY_KEYS.map((d) => {
                const s = days[d];
                return (
                  <div key={d} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-default)' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                      <input type="checkbox" checked={s.on} onChange={(e) => setDays((p) => ({ ...p, [d]: { ...p[d], on: e.target.checked } }))} />
                      <span>{d}</span>
                    </label>
                    {s.on ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="time" value={s.start} onChange={(e) => setDays((p) => ({ ...p, [d]: { ...p[d], start: e.target.value } }))} />
                        <span>–</span>
                        <input type="time" value={s.end} onChange={(e) => setDays((p) => ({ ...p, [d]: { ...p[d], end: e.target.value } }))} />
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Off</span>}
                  </div>
                );
              })}
              <div style={{ background: 'var(--bg-surface-subtle)', padding: 12, borderRadius: 9, fontSize: 13.5 }}>
                Total available: <strong>{weeklyHours} hours / week</strong>
              </div>
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => { void qc.invalidateQueries({ queryKey: ['queue'] }); toast.success('Working hours saved and queue flags recomputed.'); }}>
                Save working hours
              </button>
            </div>
          )}

          {section === 'defaults' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2>Payment defaults</h2>
              <div data-flow-id="SET-07">
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Default ready rule</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { v: 'AFTER_DEPOSIT' as const, l: 'Ready after deposit' },
                    { v: 'AFTER_FULL' as const, l: 'Ready after full payment' },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setRule(opt.v)}
                      style={{
                        padding: '8px 12px', borderRadius: 9, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                        border: `1px solid ${rule === opt.v ? 'var(--action-primary)' : 'var(--border-default)'}`,
                        background: rule === opt.v ? 'var(--bg-selected)' : '#FFFFFF',
                        color: rule === opt.v ? 'var(--action-primary)' : 'var(--text-primary)',
                      }}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              <div data-flow-id="SET-08">
                <label htmlFor="set-dep-pct" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Default deposit %: <strong>{depositPct}%</strong>
                </label>
                <input id="set-dep-pct" type="range" min={10} max={90} step={5} value={depositPct} onChange={(e) => setDepositPct(Number(e.target.value))} style={{ width: '100%' }} />
              </div>

              <div data-flow-id="SET-09">
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Who pays the processing fee?</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ v: 'OWNER' as const, l: 'I pay' }, { v: 'CLIENT' as const, l: 'My client pays' }].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setFeeBearer(o.v)}
                      style={{
                        padding: '8px 12px', borderRadius: 9, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                        border: `1px solid ${feeBearer === o.v ? 'var(--action-primary)' : 'var(--border-default)'}`,
                        background: feeBearer === o.v ? 'var(--bg-selected)' : '#FFFFFF',
                        color: feeBearer === o.v ? 'var(--action-primary)' : 'var(--text-primary)',
                      }}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              <div data-flow-id="SET-10">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label htmlFor="set-tpl" style={{ fontSize: 13, fontWeight: 600 }}>WhatsApp message template</label>
                  <button type="button" onClick={() => { setTemplate(DEFAULT_TEMPLATE); setTemplateErr(''); }} data-flow-id="SET-11" style={{ border: 0, background: 'transparent', color: 'var(--action-primary)', fontSize: 12.5, cursor: 'pointer' }}>
                    Reset to default
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {TEMPLATE_VARS.map((v) => (
                    <button key={v} type="button" onClick={() => insertVar(v)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-surface-subtle)', fontSize: 12, cursor: 'pointer' }}>
                      + {v}
                    </button>
                  ))}
                </div>
                <textarea
                  id="set-tpl"
                  rows={3}
                  value={template}
                  onChange={(e) => { setTemplate(e.target.value); setTemplateErr(''); }}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: `1px solid ${templateErr ? 'var(--status-danger)' : 'var(--border-strong)'}` }}
                />
                {templateErr && <p style={{ color: 'var(--status-danger)', fontSize: 12.5, marginTop: 4 }}>{templateErr}</p>}
              </div>

              <button type="button" className="pf-btn pf-btn--primary" disabled={saveProfile.isPending} onClick={saveDefaults}>
                Save payment defaults
              </button>
            </div>
          )}

          {section === 'notifications' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2>Notifications</h2>
              <div style={{ background: 'var(--bg-surface-subtle)', padding: 12, borderRadius: 9, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} data-flow-id="SET-12">
                <div>
                  <strong>Verified payment received (In-app)</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Always enabled for financial safety.</div>
                </div>
                <Icon name="lock" size={16} />
              </div>

              <div>
                <label htmlFor="set-due-rem" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Due-soon reminder</label>
                <select id="set-due-rem" value={dueReminderDays} onChange={(e) => setDueReminderDays(e.target.value)} data-flow-id="SET-13" style={{ height: 42, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)', background: '#FFFFFF' }}>
                  <option value="1">1 day before due</option>
                  <option value="2">2 days before due</option>
                  <option value="3">3 days before due</option>
                </select>
              </div>

              <Switch checked={digestOn} onChange={setDigestOn} label="Daily summary digest" />
              {digestOn && (
                <input type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} style={{ height: 40, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-strong)', maxWidth: 160 }} />
              )}

              <button type="button" className="pf-btn pf-btn--primary" onClick={() => saveProfile.mutate()}>
                Save notification preferences
              </button>
            </div>
          )}

          {section === 'kora' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2>Kora connection</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-flow-id="SET-14">
                <span style={{ padding: '4px 10px', borderRadius: 8, background: 'var(--status-success-tint)', color: 'var(--status-success)', fontSize: 13, fontWeight: 600 }}>
                  Connected · Test mode
                </span>
              </div>

              <div data-flow-id="SET-15">
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Webhook URL</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" readOnly value={webhookUrl} className="pd-mono" style={{ flex: 1, height: 42, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-default)', background: 'var(--bg-surface-subtle)', fontSize: 12.5 }} />
                  <button type="button" className="pf-btn pf-btn--sm pf-btn--secondary" onClick={() => void copyWebhook()}>Copy</button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Telegram payment alerts</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                  {provider.telegramLinked ? 'Telegram bot is linked to this workspace.' : 'Link Telegram to receive instant verified payment pings.'}
                </p>
                {!provider.telegramLinked && (
                  <button type="button" className="pf-btn pf-btn--secondary" disabled={linkTg.isPending} onClick={() => linkTg.mutate()}>
                    {linkTg.isPending ? 'Preparing link…' : 'Link Telegram bot'}
                  </button>
                )}
              </div>

              <button type="button" disabled title="Live payments aren't available yet." data-flow-id="SET-18" className="pf-btn pf-btn--secondary" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                Switch to live (Unavailable in sandbox)
              </button>
            </div>
          )}

          {section === 'security' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2>Account & security</h2>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                Manage active sessions across your devices.
              </p>
              <button
                type="button"
                className="pf-btn pf-btn--secondary"
                onClick={() => void signOut().then(() => nav('/login', { replace: true }))}
                data-flow-id="SET-21"
              >
                Log out of all devices
              </button>
            </div>
          )}

          {section === 'data' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2>Data</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="pf-btn pf-btn--secondary" disabled={removeSampleMut.isPending} onClick={() => removeSampleMut.mutate()} data-flow-id="SET-23">
                  {removeSampleMut.isPending ? 'Removing…' : 'Remove sample data'}
                </button>
                <button
                  type="button"
                  className="pf-btn pf-btn--secondary"
                  onClick={() => {
                    try { localStorage.removeItem('paidar.checklist.dismissed'); } catch { /* ignore */ }
                    toast.success('First-run checklist restored on Dashboard.');
                  }}
                  data-flow-id="SET-24"
                >
                  Replay first-run checklist
                </button>
              </div>
            </div>
          )}

          {section === 'danger' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, borderColor: '#F5C2C7' }}>
              <h2 style={{ color: 'var(--status-danger)' }}>Danger zone</h2>
              <Banner tone="warn">
                Deleting your account removes personal profile data. Verified financial records (payments and receipts) are retained as required by law and anonymised where permitted.
              </Banner>
              <button type="button" className="pf-btn pf-btn--danger" onClick={() => setDeleteDialogOpen(true)} data-flow-id="SET-25">
                Delete account
              </button>
            </div>
          )}
        </div>
      </div>

      {deleteDialogOpen && (
        <div className="pf-sheet-backdrop" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setDeleteDialogOpen(false)}>
          <div role="dialog" aria-modal="true" className="pf-card" style={{ maxWidth: 440, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: 'var(--status-danger)', marginBottom: 8 }}>Delete account?</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Open payment requests will be cancelled first. Type <strong>DELETE</strong> below to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Type DELETE"
              style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)', marginBottom: 14 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setDeleteDialogOpen(false)}>Cancel</button>
              <button
                type="button"
                className="pf-btn pf-btn--danger"
                disabled={deleteConfirm !== 'DELETE'}
                onClick={async () => {
                  await api('/api/me', { method: 'DELETE' });
                  await signOut();
                }}
              >
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

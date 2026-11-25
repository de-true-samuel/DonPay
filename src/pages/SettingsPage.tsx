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
import { HoldConfirmButton } from '../ui/HoldButton';
import { Banner, Switch } from '../ui/primitives';
import { Status } from '../ui/StatusChip';
import { useToast } from '../ui/Toast';
import { useFxTier, useTheme, type FxPref, type ThemePref } from '../theme/theme';
import { playPaymentAudio, readAudioPref, writeAudioPref, type AudioPref } from '../lib/feedback';

type SectionKey = 'profile' | 'appearance' | 'hours' | 'defaults' | 'notifications' | 'kora' | 'security' | 'data' | 'danger';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'profile', label: 'Business profile' },
  { key: 'appearance', label: 'Theme & visual effects' },
  { key: 'hours', label: 'Working hours' },
  { key: 'defaults', label: 'Payment defaults' },
  { key: 'notifications', label: 'Notifications & audio' },
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
  const { pref: themePref, resolved: resolvedTheme, setPref: setThemePref } = useTheme();
  const { fxPref, resolvedFx, setFxPref } = useFxTier();
  const [audioPref, setAudioPref] = useState<AudioPref>(() => readAudioPref());

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
          {SECTIONS.map((s) => {
            const active = section === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 'var(--r-sm)',
                  border: active ? '1px solid var(--volt)' : '1px solid transparent',
                  cursor: 'pointer',
                  fontSize: 13.5,
                  fontWeight: 600,
                  background: active ? 'var(--active-surface)' : 'transparent',
                  color: s.key === 'danger' ? 'var(--flare-ink)' : active ? 'var(--active-ink)' : 'var(--ink-2)',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Right Content Pane */}
        <div style={{ gridColumn: 'span 2', minWidth: 280 }}>
          {section === 'appearance' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div className="ob-overline" style={{ marginBottom: 4 }}>Appearance & Performance</div>
                <h2>Theme & visual effects</h2>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div className="pd-label">Theme</div>
                <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                  Obsidian is Paidar’s default instrument look. Daylight switches to a bright slate surface; System follows your device setting ({resolvedTheme}).
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    { v: 'obsidian', l: 'Obsidian' },
                    { v: 'daylight', l: 'Daylight' },
                    { v: 'system', l: 'System' },
                  ] as Array<{ v: ThemePref; l: string }>).map((opt) => {
                    const active = themePref === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => { setThemePref(opt.v); toast.success(`Theme set to ${opt.l}`); }}
                        className={`pf-btn pf-btn--sm ${active ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                      >
                        {opt.l}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--line-1)', paddingTop: 16 }}>
                <div className="pd-label">Visual effects</div>
                <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                  Active tier: <strong className="pd-mono" style={{ color: 'var(--ink-1)' }}>{resolvedFx.toUpperCase()}</strong>. Minimal removes ambient aurora, grain, and glass blur while keeping every payment detail and countdown exact.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    { v: 'auto', l: 'Auto' },
                    { v: 'full', l: 'Full' },
                    { v: 'lite', l: 'Lite' },
                    { v: 'min', l: 'Minimal' },
                  ] as Array<{ v: FxPref; l: string }>).map((opt) => {
                    const active = fxPref === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => { setFxPref(opt.v); toast.success(`Visual effects set to ${opt.l}`); }}
                        className={`pf-btn pf-btn--sm ${active ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                      >
                        {opt.l}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {section === 'profile' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="ob-overline" style={{ marginBottom: 4 }}>Identity</div>
                <h2>Business profile</h2>
              </div>
              <div className="pd-field">
                <label htmlFor="set-biz" className="pd-label">Business name</label>
                <input
                  id="set-biz"
                  type="text"
                  className="pd-input"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  data-flow-id="SET-01"
                />
                <p className="pd-hint">
                  Applies to new payment accounts. Links already shared keep the old name until they refresh.
                </p>
              </div>

              <div style={{ background: 'var(--bg-2)', padding: 14, borderRadius: 'var(--r-md)', border: '1px solid var(--line-2)' }} data-flow-id="SET-02">
                <div className="ob-overline" style={{ marginBottom: 4 }}>Live account-name preview</div>
                <div style={{ fontSize: 14, color: 'var(--ink-1)' }}>Account name: <strong>{previewAccountName}</strong></div>
              </div>

              <div className="pd-field">
                <label htmlFor="set-phone" className="pd-label">WhatsApp / phone</label>
                <input
                  id="set-phone"
                  type="tel"
                  className="pd-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0803 123 4567"
                  data-flow-id="SET-03"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Show my number on the payment page</span>
                <Switch
                  checked={showPhone}
                  onChange={(v) => { setShowPhone(v); toast.success('Preference updated.'); }}
                  label="Show my number on the payment page"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }} data-flow-id="SET-06">
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-1)', padding: 12, borderRadius: 'var(--r-sm)' }}>
                  <div className="ob-overline">Currency</div>
                  <strong className="pd-mono">NGN (₦)</strong>
                </div>
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-1)', padding: 12, borderRadius: 'var(--r-sm)' }}>
                  <div className="ob-overline">Timezone</div>
                  <strong className="pd-mono">Africa/Lagos</strong>
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
                      className={`pf-btn pf-btn--sm ${rule === opt.v ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              <div data-flow-id="SET-08">
                <label htmlFor="set-dep-pct" className="pd-label" style={{ display: 'block', marginBottom: 4 }}>
                  Default deposit %: <strong className="pd-mono">{depositPct}%</strong>
                </label>
                <input id="set-dep-pct" type="range" min={10} max={90} step={5} value={depositPct} onChange={(e) => setDepositPct(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--volt)' }} />
              </div>

              <div data-flow-id="SET-09">
                <div className="pd-label" style={{ marginBottom: 6 }}>Who pays the processing fee?</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ v: 'OWNER' as const, l: 'I pay' }, { v: 'CLIENT' as const, l: 'My client pays' }].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setFeeBearer(o.v)}
                      className={`pf-btn pf-btn--sm ${feeBearer === o.v ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              <div data-flow-id="SET-10">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label htmlFor="set-tpl" className="pd-label">WhatsApp message template</label>
                  <button type="button" className="pf-btn pf-btn--sm pf-btn--quiet" onClick={() => { setTemplate(DEFAULT_TEMPLATE); setTemplateErr(''); }} data-flow-id="SET-11">
                    Reset to default
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {TEMPLATE_VARS.map((v) => (
                    <button key={v} type="button" onClick={() => insertVar(v)} className="pd-chip" style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}>
                      + {v}
                    </button>
                  ))}
                </div>
                <textarea
                  id="set-tpl"
                  rows={3}
                  className="pd-input pd-input--area"
                  value={template}
                  onChange={(e) => { setTemplate(e.target.value); setTemplateErr(''); }}
                />
                {templateErr && <p className="pd-error" style={{ marginTop: 4 }}>{templateErr}</p>}
              </div>

              <button type="button" className="pf-btn pf-btn--primary" disabled={saveProfile.isPending} onClick={saveDefaults}>
                Save payment defaults
              </button>
            </div>
          )}

          {section === 'notifications' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="ob-overline" style={{ marginBottom: 4 }}>Alerts & Audio</div>
                <h2>Notifications & payment audio</h2>
              </div>
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', padding: 12, borderRadius: 'var(--r-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} data-flow-id="SET-12">
                <div>
                  <strong style={{ color: 'var(--ink-1)' }}>Verified payment received (In-app)</strong>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Always enabled for financial safety.</div>
                </div>
                <Icon name="lock" size={16} />
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div className="pd-label">Payment Audio (Paid Ping)</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    { v: 'bell', l: 'Subtle Bell' },
                    { v: 'drum', l: 'Deep Drum' },
                    { v: 'silent', l: 'Silent (vibration only)' },
                  ] as Array<{ v: AudioPref; l: string }>).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      className={`pf-btn pf-btn--sm ${audioPref === opt.v ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                      onClick={() => {
                        setAudioPref(opt.v);
                        writeAudioPref(opt.v);
                        playPaymentAudio(opt.v);
                      }}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pd-field">
                <label htmlFor="set-due-rem" className="pd-label">Due-soon reminder</label>
                <select id="set-due-rem" className="pd-input" value={dueReminderDays} onChange={(e) => setDueReminderDays(e.target.value)} data-flow-id="SET-13" style={{ maxWidth: 220 }}>
                  <option value="1">1 day before due</option>
                  <option value="2">2 days before due</option>
                  <option value="3">3 days before due</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Daily summary digest</span>
                <Switch checked={digestOn} onChange={setDigestOn} label="Daily summary digest" />
              </div>
              {digestOn && (
                <input type="time" className="pd-input" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} style={{ maxWidth: 160 }} />
              )}

              <button type="button" className="pf-btn pf-btn--primary" onClick={() => saveProfile.mutate()}>
                Save notification preferences
              </button>
            </div>
          )}

          {section === 'kora' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="ob-overline" style={{ marginBottom: 4 }}>Bank Infrastructure</div>
                <h2>Kora connection</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-flow-id="SET-14">
                <Status tone="solar" icon="clock" label="Connected · Test mode" />
              </div>

              <div data-flow-id="SET-15">
                <div className="pd-label" style={{ marginBottom: 4 }}>Webhook URL</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" readOnly value={webhookUrl} className="pd-input pd-mono" style={{ flex: 1, fontSize: 12.5 }} />
                  <button type="button" className="pf-btn pf-btn--sm pf-btn--secondary" onClick={() => void copyWebhook()}>Copy</button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--line-1)', paddingTop: 14 }}>
                <div className="pd-label" style={{ marginBottom: 6 }}>Telegram payment alerts</div>
                <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 10 }}>
                  {provider.telegramLinked ? 'Telegram bot is linked to this workspace.' : 'Link Telegram to receive instant verified payment pings.'}
                </p>
                {!provider.telegramLinked && (
                  <button type="button" className="pf-btn pf-btn--secondary" disabled={linkTg.isPending} onClick={() => linkTg.mutate()}>
                    {linkTg.isPending ? 'Preparing link…' : 'Link Telegram bot'}
                  </button>
                )}
              </div>

              <button type="button" disabled title="Live payments aren't available yet." data-flow-id="SET-18" className="pf-btn pf-btn--secondary">
                Switch to live (Unavailable in sandbox)
              </button>
            </div>
          )}

          {section === 'security' && (
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="ob-overline" style={{ marginBottom: 4 }}>Sessions</div>
                <h2>Account & security</h2>
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
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
              <div>
                <div className="ob-overline" style={{ marginBottom: 4 }}>Workspace Data</div>
                <h2>Data</h2>
              </div>
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
            <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, borderColor: 'var(--flare-bd)' }}>
              <h2 style={{ color: 'var(--flare-ink)' }}>Danger zone</h2>
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
          <div role="dialog" aria-modal="true" className="ob-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: 'var(--flare-ink)', marginBottom: 8 }}>Delete account?</h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 12 }}>
              Open payment requests will be cancelled first. Type <strong>DELETE</strong> below, then hold to confirm.
            </p>
            <input
              type="text"
              className="pd-input pd-mono"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Type DELETE"
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setDeleteDialogOpen(false)}>Cancel</button>
              <HoldConfirmButton
                label="Delete forever"
                disabled={deleteConfirm !== 'DELETE'}
                onConfirm={async () => {
                  await api('/api/me', { method: 'DELETE' });
                  await signOut();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

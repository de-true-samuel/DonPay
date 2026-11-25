import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { meApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import type { ReadyRule } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { markOnboarded } from '../lib/onboarding';
import { LogoMark } from '../ui/Logo';
import { Banner, Switch, TextField } from '../ui/primitives';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

type DaySched = { enabled: boolean; start: string; end: string };
type HoursMap = Record<DayKey, DaySched>;

const PRESET_MF: HoursMap = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '17:00' },
  sun: { enabled: false, start: '09:00', end: '17:00' },
};

const PRESET_MS: HoursMap = {
  ...PRESET_MF,
  sat: { enabled: true, start: '09:00', end: '17:00' },
};

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function OnboardingPage() {
  useDocumentTitle('Set up your business');
  const { provider, signOut } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();

  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [leaving, setLeaving] = useState(false);

  // Step 1: Business
  const [name, setName] = useState(provider?.businessName ?? '');
  const [phone, setPhone] = useState('');
  const [showPhone, setShowPhone] = useState(true);
  const [bizType, setBizType] = useState('CREATIVE_DESIGN');
  const [nameErr, setNameErr] = useState('');

  // Step 2: Working hours
  const [preset, setPreset] = useState<'mf' | 'ms' | 'custom'>('mf');
  const [hours, setHours] = useState<HoursMap>(PRESET_MF);
  const [hoursErr, setHoursErr] = useState('');

  // Step 3: Payment defaults
  const [terms, setTerms] = useState<'FULL' | 'DEPOSIT' | 'PAY_ON_DELIVERY'>('FULL');
  const [depositPct, setDepositPct] = useState(50);
  const [feeBearer, setFeeBearer] = useState<'OWNER' | 'CLIENT'>('OWNER');

  const save = useMutation({
    mutationFn: meApi.update,
    onSuccess: (p) => qc.setQueryData(ME_KEY, p),
  });

  const weeklyHours = useMemo(() => {
    let mins = 0;
    for (const d of DAYS) {
      const s = hours[d.key];
      if (!s.enabled) continue;
      const diff = toMin(s.end) - toMin(s.start);
      if (diff > 0) mins += diff;
    }
    return Math.round((mins / 60) * 10) / 10;
  }, [hours]);

  if (!provider) return null;
  const err = describeError(save.error);
  const previewAccountName = name.trim().replace(/[^a-zA-Z0-9 '&.-]/g, '').slice(0, 40) || 'Your Business Name';

  function goToStep(s: number) {
    if (s <= maxStep) setStep(s);
  }

  function handleStep1() {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 40) {
      setNameErr('Business name must be 2–40 characters.');
      return;
    }
    setNameErr('');
    save.mutate(
      { businessName: clean },
      {
        onSuccess: () => {
          setStep(2);
          setMaxStep((m) => Math.max(m, 2));
        },
      },
    );
  }

  function handleStep2() {
    const active = DAYS.filter((d) => hours[d.key].enabled);
    if (active.length === 0) {
      setHoursErr('At least one working day must be active.');
      return;
    }
    for (const d of active) {
      const diff = toMin(hours[d.key].end) - toMin(hours[d.key].start);
      if (diff <= 0) {
        setHoursErr(`End time must be after start time for ${d.label}.`);
        return;
      }
      if (diff > 16 * 60) {
        setHoursErr(`Maximum 16 hours per day (${d.label}).`);
        return;
      }
    }
    setHoursErr('');
    setStep(3);
    setMaxStep((m) => Math.max(m, 3));
  }

  function handleFinish() {
    const rule: ReadyRule = terms === 'DEPOSIT' ? 'AFTER_DEPOSIT' : 'AFTER_FULL';
    save.mutate(
      { defaultReadyRule: rule },
      {
        onSuccess: () => {
          markOnboarded(provider!.id);
          nav('/app', { replace: true });
        },
      },
    );
  }

  function saveAndExit() {
    markOnboarded(provider!.id);
    nav('/app', { replace: true });
  }

  return (
    <div style={{ minHeight: '100dvh', padding: '24px 16px 64px' }} data-flow-id="ONB-00">
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ink-1)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.03em' }}>
            <LogoMark size={26} />
            <span>paidar</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={saveAndExit} data-flow-id="ONB-00c" className="pf-btn pf-btn--sm pf-btn--quiet">
              Save and exit
            </button>
            <button
              type="button"
              disabled={leaving}
              onClick={() => { setLeaving(true); void signOut().then(() => nav('/auth', { replace: true })); }}
              className="pf-btn pf-btn--sm pf-btn--quiet"
            >
              {leaving ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>

        {/* 3-Step Progress Stepper (ONB-00a) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }} data-flow-id="ONB-00a">
          {[
            { n: 1, label: '1. Your business' },
            { n: 2, label: '2. Working hours' },
            { n: 3, label: '3. How you get paid' },
          ].map((item) => {
            const active = step === item.n;
            const completed = item.n < step;
            const clickable = item.n <= maxStep;
            return (
              <button
                key={item.n}
                type="button"
                disabled={!clickable}
                onClick={() => goToStep(item.n)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-md)',
                  textAlign: 'left',
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1px solid ${active ? 'var(--volt)' : completed ? 'var(--mint-bd)' : 'var(--line-1)'}`,
                  background: active ? 'var(--active-surface)' : completed ? 'var(--mint-bg)' : 'var(--bg-1)',
                  color: active ? 'var(--active-ink)' : completed ? 'var(--mint-ink)' : clickable ? 'var(--ink-1)' : 'var(--ink-3)',
                  cursor: clickable ? 'pointer' : 'default',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {save.isError && <Banner tone="bad"><strong>Could not save:</strong> {err.message}</Banner>}

        {/* Step 1: Your business */}
        {step === 1 && (
          <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h1>Your business</h1>
              <p style={{ color: 'var(--ink-2)', marginTop: 4 }}>
                This is how clients recognize your business when they open your payment link.
              </p>
            </div>

            <TextField
              label="Business or studio name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameErr(''); }}
              error={nameErr}
              placeholder="e.g. Tolu's Glam Studio"
              data-flow-id="ONB-01"
            />

            {/* Live Account Name Preview (ONB-02) */}
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-md)', padding: 14 }} data-flow-id="ONB-02">
              <div className="ob-overline" style={{ marginBottom: 4 }}>Live bank-app preview</div>
              <div style={{ fontSize: 14, color: 'var(--ink-1)' }}>
                Account name: <strong>{previewAccountName}</strong>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                Final accepted account name depends on Kora’s naming rules.
              </p>
            </div>

            <TextField
              label="WhatsApp / phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0803 123 4567"
              data-flow-id="ONB-03"
            />

            {phone.trim() && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Show my number on the payment page</span>
                <Switch
                  checked={showPhone}
                  onChange={setShowPhone}
                  label="Show my number on the payment page"
                />
              </div>
            )}

            <div className="pd-field">
              <label htmlFor="onb-type" className="pd-label">
                What do you do? (optional)
              </label>
              <select
                id="onb-type"
                className="pd-input"
                value={bizType}
                onChange={(e) => setBizType(e.target.value)}
                data-flow-id="ONB-05"
              >
                <option value="CREATIVE_DESIGN">Creative / Design</option>
                <option value="DIGITAL_SERVICES">Digital services</option>
                <option value="REPAIRS_MAINTENANCE">Repairs & maintenance</option>
                <option value="PRINTING_PRODUCTION">Printing & production</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <button type="button" className="pf-btn pf-btn--primary" disabled={save.isPending} onClick={handleStep1} data-flow-id="ONB-06">
              {save.isPending ? 'Saving…' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 2: When do you work? */}
        {step === 2 && (
          <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h1>When do you work?</h1>
              <p style={{ color: 'var(--ink-2)', marginTop: 4 }}>
                Used to flag when upcoming job deadlines exceed your available hours.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-flow-id="ONB-07">
              <button
                type="button"
                className={`pf-btn pf-btn--sm ${preset === 'mf' ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                onClick={() => { setPreset('mf'); setHours(PRESET_MF); setHoursErr(''); }}
              >
                Mon–Fri 9–5
              </button>
              <button
                type="button"
                className={`pf-btn pf-btn--sm ${preset === 'ms' ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                onClick={() => { setPreset('ms'); setHours(PRESET_MS); setHoursErr(''); }}
              >
                Mon–Sat 9–5
              </button>
              <button
                type="button"
                className={`pf-btn pf-btn--sm ${preset === 'custom' ? 'pf-btn--primary' : 'pf-btn--secondary'}`}
                onClick={() => setPreset('custom')}
              >
                Custom
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DAYS.map((d) => {
                const s = hours[d.key];
                return (
                  <div key={d.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-1)' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, minWidth: 80, color: 'var(--ink-1)' }}>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        style={{ accentColor: 'var(--volt)' }}
                        onChange={(e) => {
                          setPreset('custom');
                          setHours((prev) => ({ ...prev, [d.key]: { ...prev[d.key], enabled: e.target.checked } }));
                        }}
                      />
                      <span>{d.label}</span>
                    </label>
                    {s.enabled ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="time"
                          className="pd-input"
                          value={s.start}
                          onChange={(e) => {
                            setPreset('custom');
                            setHours((prev) => ({ ...prev, [d.key]: { ...prev[d.key], start: e.target.value } }));
                          }}
                          style={{ width: 'auto', minHeight: 38, padding: '4px 10px' }}
                        />
                        <span style={{ color: 'var(--ink-3)' }}>to</span>
                        <input
                          type="time"
                          className="pd-input"
                          value={s.end}
                          onChange={(e) => {
                            setPreset('custom');
                            setHours((prev) => ({ ...prev, [d.key]: { ...prev[d.key], end: e.target.value } }));
                          }}
                          style={{ width: 'auto', minHeight: 38, padding: '4px 10px' }}
                        />
                      </div>
                    ) : (
                      <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Off</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-1)', padding: 12, borderRadius: 'var(--r-md)', fontSize: 13.5, color: 'var(--ink-2)' }} data-flow-id="ONB-10">
              You have about <strong className="pd-mono" style={{ color: 'var(--ink-1)' }}>{weeklyHours} working hours</strong> a week.
            </div>

            {hoursErr && <p className="pd-error" role="alert">{hoursErr}</p>}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setStep(1)} data-flow-id="ONB-00b">Back</button>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" className="pf-btn pf-btn--sm pf-btn--quiet" onClick={() => { setHours(PRESET_MF); setStep(3); setMaxStep(3); }} data-flow-id="ONB-12">
                  Skip, use defaults
                </button>
                <button type="button" className="pf-btn pf-btn--primary" onClick={handleStep2} data-flow-id="ONB-11">Continue</button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: How you get paid */}
        {step === 3 && (
          <div className="pf-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h1>How you get paid</h1>
              <p style={{ color: 'var(--ink-2)', marginTop: 4 }}>
                Set your defaults for new payment requests. You can override these per job.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-flow-id="ONB-13">
              <div className="pd-label">Default payment terms</div>
              {[
                { val: 'FULL' as const, title: 'Pay in full first (default)', desc: 'Job becomes Ready once the full amount is verified.' },
                { val: 'DEPOSIT' as const, title: 'Deposit', desc: 'Collect a deposit upfront; request the balance on delivery.' },
                { val: 'PAY_ON_DELIVERY' as const, title: 'Pay on delivery', desc: 'Job starts Ready immediately; request payment when delivered.' },
              ].map((opt) => (
                <label key={opt.val} className={`pd-choice ${terms === opt.val ? 'is-on' : ''}`}>
                  <input type="radio" name="terms" checked={terms === opt.val} onChange={() => setTerms(opt.val)} />
                  <span className="pd-choice__title">{opt.title}</span>
                  <span className="pd-choice__text">{opt.desc}</span>
                </label>
              ))}
            </div>

            {terms === 'DEPOSIT' && (
              <div data-flow-id="ONB-14">
                <label htmlFor="dep-pct" className="pd-label" style={{ display: 'block', marginBottom: 6 }}>
                  Deposit percentage: <strong className="pd-mono">{depositPct}%</strong>
                </label>
                <input
                  id="dep-pct"
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={depositPct}
                  onChange={(e) => setDepositPct(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--volt)' }}
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-flow-id="ONB-15">
              <div className="pd-label">Who pays the processing fee?</div>
              {[
                { val: 'OWNER' as const, title: 'I do (default)', desc: 'Your client pays the exact quoted price.' },
                { val: 'CLIENT' as const, title: 'My client does', desc: 'Exact fee shown on the payment page.' },
              ].map((opt) => (
                <label key={opt.val} className={`pd-choice ${feeBearer === opt.val ? 'is-on' : ''}`}>
                  <input type="radio" name="fee" checked={feeBearer === opt.val} onChange={() => setFeeBearer(opt.val)} />
                  <span className="pd-choice__title">{opt.title}</span>
                  <span className="pd-choice__text">{opt.desc}</span>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setStep(2)}>Back</button>
              <button type="button" className="pf-btn pf-btn--primary" disabled={save.isPending} onClick={handleFinish} data-flow-id="ONB-16">
                {save.isPending ? 'Finishing…' : 'Finish setup'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

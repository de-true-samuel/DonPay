import { useMemo, useState } from 'react';
import { useDocumentTitle } from '../lib/hooks';
import { REQUEST_STATUS } from '../lib/labels';
import type { RequestStatus } from '../contract/contract';
import { useFxTier, useTheme, type FxPref, type ThemePref } from '../theme/theme';
import { CopyChip } from '../ui/CopyChip';
import { CountdownRing } from '../ui/CountdownRing';
import { HoldConfirmButton } from '../ui/HoldButton';
import { Money } from '../ui/Money';
import { Banner, Button, EmptyState, Skeleton, TextField } from '../ui/primitives';
import { AttemptStatusChip, FlagChip, JobStatusChip, PaymentStatusChip, Status } from '../ui/StatusChip';
import { TicketCard } from '../ui/TicketCard';
import { StatusPill, TrustBadge } from '../ui/Trust';

const SWATCHES: Array<[string, string]> = [
  ['bg-void', '--bg-void'],
  ['bg-canvas', '--bg-canvas'],
  ['bg-1', '--bg-1'],
  ['bg-2', '--bg-2'],
  ['bg-3', '--bg-3'],
  ['bg-4', '--bg-4'],
  ['volt', '--volt'],
  ['mint', '--mint'],
  ['solar', '--solar'],
  ['flare', '--flare'],
  ['ion', '--ion'],
  ['ultra', '--ultra'],
  ['slate', '--slate'],
  ['ink-1', '--ink-1'],
  ['ink-2', '--ink-2'],
  ['ink-3', '--ink-3'],
];

export function KitPage() {
  useDocumentTitle('Design kit · Obsidian Signal');
  const { pref: themePref, setPref: setThemePref } = useTheme();
  const { fxPref, resolvedFx, setFxPref } = useFxTier();
  const [holdCount, setHoldCount] = useState(0);

  const t = useMemo(() => {
    const n = Date.now();
    return {
      sent: new Date(n - 20 * 60_000).toISOString(),
      ok: new Date(n + 40 * 60_000).toISOString(),
      soon: new Date(n + 8 * 60_000).toISOString(),
      gone: new Date(n - 60_000).toISOString(),
    };
  }, []);

  return (
    <div className="pd-stack">
      <header className="pf-page-head">
        <div>
          <div className="ob-overline">QA Design Specimen Surface (§6.15)</div>
          <h1>Obsidian Signal UI Kit</h1>
          <p className="pf-page-head__sub">Compare Obsidian vs Daylight themes and test all Visual FX tiers live.</p>
        </div>
        <div className="pf-page-head__actions">
          {(['obsidian', 'daylight', 'system'] as ThemePref[]).map((m) => (
            <button key={m} type="button" className={`pf-btn pf-btn--sm ${themePref === m ? 'pf-btn--primary' : 'pf-btn--secondary'}`} onClick={() => setThemePref(m)}>
              {m}
            </button>
          ))}
          {(['auto', 'full', 'lite', 'min'] as FxPref[]).map((f) => (
            <button key={f} type="button" className={`pf-btn pf-btn--sm ${fxPref === f ? 'pf-btn--primary' : 'pf-btn--secondary'}`} onClick={() => setFxPref(f)}>
              FX: {f}
            </button>
          ))}
        </div>
      </header>

      <p className="pd-hint">Current resolved FX tier: <strong className="pd-mono">{resolvedFx}</strong></p>

      <section className="pf-card">
        <div className="ob-overline" style={{ marginBottom: 12 }}>Tokens & Palette</div>
        <div className="pd-swatches">
          {SWATCHES.map(([n, v]) => (
            <div key={n}>
              <i style={{ background: `var(${v})` }} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="pf-card" style={{ display: 'grid', gap: 14 }}>
        <div className="ob-overline">Typography & Money</div>
        <p className="pd-kit-display">Tolu paid <Money kobo="2500000" size="lg" tone="mint" animate /></p>
        <div className="pd-kit-money">
          <Money kobo="2500000" size="xl" />
          <Money kobo="2500050" size="lg" />
          <Money kobo="-250000" size="md" />
          <Money kobo="9900" size="sm" />
          <Money kobo="0" size="sm" />
        </div>
      </section>

      <section className="pf-card" style={{ display: 'grid', gap: 12 }}>
        <div className="ob-overline">Semantic Status System (§3.3)</div>
        <div className="pd-kit-line">
          <Status tone="mint" icon="shield" label="Paid" />
          <Status tone="solar" icon="clock" label="Awaiting payment" />
          <Status tone="solar" icon="radar" label="Customer says paid" pulse />
          <Status tone="flare" icon="alert" label="Overdue" />
          <Status tone="flare" icon="undo" label="Refunded" />
          <Status tone="ion" icon="zap" label="Ready" />
          <Status tone="ultra" icon="loader" label="In progress" />
          <Status tone="slate" icon="minus-circle" label="Expired" />
          <Status tone="slate" icon="x-circle" label="Cancelled" struck />
        </div>
        <div className="pd-kit-line">
          <TrustBadge kind="verified" />
          <TrustBadge kind="manual" />
          <TrustBadge kind="simulated" />
          {(Object.keys(REQUEST_STATUS) as RequestStatus[]).map((s) => (
            <StatusPill key={s} status={s} />
          ))}
          <PaymentStatusChip status="awaiting_payment" />
          <AttemptStatusChip status="account_active" />
          <JobStatusChip status="in_progress" />
          <FlagChip flag="customer_claimed" />
        </div>
      </section>

      <section className="pf-card" style={{ display: 'grid', gap: 16 }}>
        <div className="ob-overline">Signal Tickets (§4.5)</div>
        <TicketCard hero state="waiting" title="Tolu · Bridal makeup" subtitle="Wema Bank · 9012345678 · Active transfer" amountKobo="2500000" status={<StatusPill status="SENT" />} aside={<CountdownRing sentAt={t.sent} expiresAt={t.ok} />} />
        <TicketCard state="claims" title="Chidi · Brand sprint" subtitle="Customer tapped I've paid" amountKobo="1800000" status={<FlagChip flag="customer_claimed" />} aside={<CountdownRing sentAt={t.sent} expiresAt={t.soon} />} />
        <TicketCard state="paid" title="Ada · Aso-ebi fitting" subtitle="Balance · paid 2h ago" amountKobo="1500000" trust="verified" status={<StatusPill status="PAID" />} footer={<TrustBadge kind="verified" />} />
        <TicketCard ghost state="draft" title="Draft job preview" subtitle="Account allocated after submission" amountKobo="3500000" status={<StatusPill status="DRAFT" />} />
        <TicketCard state="paid" simulated title="Sandbox payer" subtitle="Test payment" amountKobo="500000" trust="simulated" status={<StatusPill status="PAID" />} footer={<TrustBadge kind="simulated" />} />
      </section>

      <section className="pf-card" style={{ display: 'grid', gap: 12 }}>
        <div className="ob-overline">Chrono Ring (§4.6)</div>
        <div className="pd-kit-line">
          <CountdownRing sentAt={t.sent} expiresAt={t.ok} size="hero" caption="60-min window" />
          <CountdownRing sentAt={t.sent} expiresAt={t.soon} size="md" caption="Urgent" />
          <CountdownRing sentAt={t.sent} expiresAt={t.gone} size="md" caption="Expired" />
        </div>
      </section>

      <section className="pf-card" style={{ display: 'grid', gap: 14 }}>
        <div className="ob-overline">Buttons, Ink-flood Copy & Hold-to-confirm</div>
        <div className="pd-kit-line">
          <Button>Primary</Button>
          <Button variant="line">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <Button busy>Saving</Button>
          <CopyChip value="9012345678" label="Copy account" />
          <HoldConfirmButton label={`Confirmed ${holdCount}x`} onConfirm={() => setHoldCount((c) => c + 1)} />
        </div>
        <TextField label="Customer phone" placeholder="0803 123 4567" hint="Nigerian numbers work as typed." />
        <TextField label="Amount" defaultValue="abc" error="Enter an amount like 25k or 25,000" />
        <Banner tone="warn">Connect Telegram to get a ping the moment someone pays.</Banner>
        <Banner tone="bad">Kora didn’t respond. Nothing was charged. Try again.</Banner>
      </section>

      <section className="pf-card" style={{ display: 'grid', gap: 14 }}>
        <div className="ob-overline">Skeletons & Empty States</div>
        <div className="pd-stack">
          <Skeleton h={22} w="60%" />
          <Skeleton h={14} />
          <Skeleton h={14} w="80%" />
        </div>
        <EmptyState title="Nothing here yet">Empty states say what this is and give one next step.</EmptyState>
      </section>
    </div>
  );
}

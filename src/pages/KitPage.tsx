import { useMemo } from 'react';
import { useDocumentTitle } from '../lib/hooks';
import { CountdownRing } from '../ui/CountdownRing';
import { Money } from '../ui/Money';
import { Banner, Button, EmptyState, Skeleton, TextField } from '../ui/primitives';
import { StatusPill, TrustBadge } from '../ui/Trust';
import { TicketCard } from '../ui/TicketCard';
import { REQUEST_STATUS } from '../lib/labels';
import type { RequestStatus } from '../contract/contract';

const SWATCHES: Array<[string, string]> = [
  ['ink', '--ink'], ['violet', '--violet'], ['lavender', '--lavender'], ['violet-soft', '--violet-soft'],
  ['mint', '--mint'], ['mint-ink', '--mint-ink'], ['amber', '--amber-ink'], ['red', '--red-ink'], ['night', '--night'],
];

export function KitPage() {
  useDocumentTitle('Design kit');
  const t = useMemo(() => {
    const n = Date.now();
    return {
      sent: new Date(n - 20 * 60_000).toISOString(), ok: new Date(n + 70 * 60_000).toISOString(),
      soon: new Date(n + 12 * 60_000).toISOString(), gone: new Date(n - 60_000).toISOString(),
    };
  }, []);
  return (
    <div className="pd-stack">
      <header className="pd-pagehead"><h1>Design kit</h1><p className="pd-sub">Every building block, on one page.</p></header>

      <section className="pd-section"><h2>Colour</h2>
        <div className="pd-swatches">{SWATCHES.map(([n, v]) => (
          <div key={n}><i style={{ background: `var(${v})` }} /><span>{n}</span></div>))}</div>
      </section>

      <section className="pd-section"><h2>Type and money</h2>
        <p className="pd-kit-display">Tolu paid ₦25,000</p>
        <div className="pd-kit-money">
          <Money kobo="2500000" size="xl" /><Money kobo="2500050" size="lg" /><Money kobo="-250000" size="md" /><Money kobo="9900" size="sm" />
        </div>
        <p className="pd-hint">Digits are tabular so columns of amounts line up.</p>
      </section>

      <section className="pd-section"><h2>Trust grammar</h2>
        <p className="pd-hint">Solid outline: verified by Kora. Dashed: entered by hand. Dotted: sandbox details.</p>
        <div className="pd-kit-line"><TrustBadge kind="verified" /><TrustBadge kind="manual" /><TrustBadge kind="simulated" /></div>
        <div className="pd-kit-line">{(Object.keys(REQUEST_STATUS) as RequestStatus[]).map((s) => <StatusPill key={s} status={s} />)}</div>
      </section>

      <section className="pd-section"><h2>Tickets</h2>
        <TicketCard title="Tolu · Bridal makeup" subtitle="Deposit · created 20 minutes ago · not copied yet" amountKobo="2500000"
          status={<StatusPill status="SENT" />} aside={<CountdownRing sentAt={t.sent} expiresAt={t.ok} />} />
        <TicketCard title="Ada · Aso-ebi fitting" subtitle="Balance · paid 2h ago" amountKobo="1500000" trust="verified"
          status={<StatusPill status="PAID" />} footer={<TrustBadge kind="verified" />} />
        <TicketCard title="Emeka · Photo shoot" subtitle="Cash, recorded by you" amountKobo="1000000" trust="manual"
          status={<StatusPill status="PAID" />} footer={<TrustBadge kind="manual" />} />
        <TicketCard title="Sandbox payer" subtitle="Test payment" amountKobo="500000" trust="simulated"
          status={<StatusPill status="PAID" />} footer={<TrustBadge kind="simulated" />} />
      </section>

      <section className="pd-section"><h2>Countdown ring</h2>
        <div className="pd-kit-line">
          <CountdownRing sentAt={t.sent} expiresAt={t.ok} />
          <CountdownRing sentAt={t.sent} expiresAt={t.soon} />
          <CountdownRing sentAt={t.sent} expiresAt={t.gone} />
        </div>
      </section>

      <section className="pd-section"><h2>Controls</h2>
        <div className="pd-kit-line">
          <Button>Primary</Button><Button variant="line">Outline</Button><Button variant="quiet">Quiet</Button><Button variant="danger">Danger</Button>
          <Button busy>Saving</Button>
        </div>
        <TextField label="Customer phone" placeholder="0803 123 4567" hint="Nigerian numbers work as typed." />
        <TextField label="Amount" defaultValue="abc" error="Enter an amount like 25k or 25,000" />
        <Banner tone="warn">Connect Telegram to get a ping the moment someone pays.</Banner>
        <Banner tone="bad">Kora didn’t respond. Nothing was charged. Try again.</Banner>
      </section>

      <section className="pd-section"><h2>Loading and empty</h2>
        <div className="pd-stack"><Skeleton h={22} w="60%" /><Skeleton h={14} /><Skeleton h={14} w="80%" /></div>
        <EmptyState title="Nothing here yet">Empty states say what this is and give one next step.</EmptyState>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hapticPaidPing } from '../../lib/feedback';
import { Icon } from '../../ui/Icon';
import { Money } from '../../ui/Money';
import { useToday } from '../today/useToday';

interface Ping { id: string; name: string; service: string; amountKobo: string; ready: boolean; jobId: string }

/**
 * The Paid Ping (§4.8):
 * Raised glass notice with Mint shield-check marker, money-md tabular display,
 * expanding payment shockwave rings on live arrival, haptic pulse, and optional Bell/Drum audio.
 */
export function PaidPingLayer() {
  const { data } = useToday();
  const seen = useRef<Set<string> | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);

  useEffect(() => {
    if (!data) return;
    if (seen.current === null) { seen.current = new Set(data.justPaid.map((x) => x.payment.id)); return; }
    const known = seen.current;
    const fresh = data.justPaid.filter((x) => !known.has(x.payment.id));
    if (!fresh.length) return;
    fresh.forEach((x) => known.add(x.payment.id));
    setPings((p) => [
      ...fresh.map((x) => ({
        id: x.payment.id, name: x.job.customer.name.split(' ')[0], service: x.job.service,
        amountKobo: x.payment.amountKobo, ready: x.job.readyToStart, jobId: x.job.id,
      })),
      ...p,
    ].slice(0, 3));
    hapticPaidPing();
  }, [data]);

  const dismiss = (id: string) => setPings((p) => p.filter((x) => x.id !== id));
  return (
    <div className="pd-pings" aria-live="polite">
      {pings.map((p) => <PingItem key={p.id} ping={p} onDismiss={() => dismiss(p.id)} />)}
    </div>
  );
}

function PingItem({ ping, onDismiss }: { ping: Ping; onDismiss: () => void }) {
  const nav = useNavigate();
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => { const t = setTimeout(() => latest.current(), 8000); return () => clearTimeout(t); }, []);
  return (
    <div className="pd-ping-toast ob-glass">
      <span className="pd-ping-toast__disc" aria-hidden="true">
        <span className="ob-shockwave">
          <i className="ob-shockwave__ring ob-shockwave__ring--1" />
          <i className="ob-shockwave__ring ob-shockwave__ring--2" />
        </span>
        <Icon name="shield" size={20} />
      </span>
      <button type="button" className="pd-ping-toast__body" onClick={() => { onDismiss(); nav(`/app/payments?tab=received&payment=${ping.id}`); }}>
        <strong>{ping.name} paid <Money kobo={ping.amountKobo} size="md" tone="mint" /></strong>
        <span>{ping.service}{ping.ready ? ' · Ready to start' : ''}</span>
      </button>
      <button type="button" className="pd-iconbtn pd-iconbtn--light" aria-label="Dismiss" onClick={onDismiss}><Icon name="x" size={18} /></button>
    </div>
  );
}

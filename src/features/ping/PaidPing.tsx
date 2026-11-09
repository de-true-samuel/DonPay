import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../ui/Icon';
import { Money } from '../../ui/Money';
import { useToday } from '../today/useToday';

interface Ping { id: string; name: string; service: string; amountKobo: string; ready: boolean; jobId: string }

/**
 * The paid moment. Compares each poll of Today with the payments already seen, so only payments that
 * arrive while the app is open ping. The first poll just records what's already there.
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
    navigator.vibrate?.(80);
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
  useEffect(() => { const t = setTimeout(() => latest.current(), 9000); return () => clearTimeout(t); }, []);
  return (
    <div className="pd-ping-toast">
      <span className="pd-ping-toast__disc" aria-hidden="true">
        <span className="pd-ping"><i /><i /></span>
        <Icon name="check" size={22} />
      </span>
      <button type="button" className="pd-ping-toast__body" onClick={() => { onDismiss(); nav(`/jobs/${ping.jobId}`); }}>
        <strong>{ping.name} paid <Money kobo={ping.amountKobo} size="sm" /></strong>
        <span>{ping.service}{ping.ready ? ' · Ready to start' : ''}</span>
      </button>
      <button type="button" className="pd-iconbtn pd-iconbtn--light" aria-label="Dismiss" onClick={onDismiss}><Icon name="x" size={18} /></button>
    </div>
  );
}

/** All display times are Africa/Lagos. */
const lagos = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', ...o });

export const formatTime = (iso: string): string =>
  lagos({ hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

export const formatDateTime = (iso: string): string =>
  lagos({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso));

export const formatDate = (iso: string): string =>
  lagos({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : formatDate(iso);
}

/** "32:10" under an hour, "1h 05m" above. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}:${pad(s)}`;
}

/* ---------- Lagos wall-clock helpers (UTC+1 all year, no daylight saving) ---------- */
const LAGOS_MS = 3_600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

export function lagosParts(d: Date = new Date()): { y: number; m: number; d: number; dow: number } {
  const s = new Date(d.getTime() + LAGOS_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), dow: s.getUTCDay() };
}

/** "2026-11-06T09:00" typed in a datetime-local field, read as Lagos time, to an ISO instant. */
export const lagosLocalToIso = (local: string): string => `${local}:00+01:00`;
/** "2026-11-12" to 9:00 Lagos on that day. */
export const lagosDateToIso = (date: string, hour = 9): string => `${date}T${pad2(hour)}:00:00+01:00`;

/** Current Lagos wall-clock as "YYYY-MM-DDTHH:mm" (for datetime-local min), optionally shifted. */
export function nowLagosLocal(plusMinutes = 0): string {
  return new Date(Date.now() + LAGOS_MS + plusMinutes * 60_000).toISOString().slice(0, 16);
}
/** Tomorrow at the given hour, Lagos wall-clock, for datetime-local defaults. */
export function tomorrowLagosLocal(hour = 9): string {
  return new Date(Date.now() + LAGOS_MS + 86_400_000).toISOString().slice(0, 10) + `T${pad2(hour)}:00`;
}

/** An ISO instant to its Lagos calendar date, "YYYY-MM-DD", for <input type="date">. */
export const isoToLagosDate = (iso: string): string => new Date(Date.parse(iso) + LAGOS_MS).toISOString().slice(0, 10);

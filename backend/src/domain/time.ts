/**
 * Africa/Lagos is UTC+1 all year (no daylight saving), so local time is a fixed offset.
 * Keeping it in one place means we can switch to Intl if that ever changes.
 */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Date whose UTC fields read as Lagos wall-clock time. Only use its getUTC* methods. */
function lagosWall(d: Date): Date {
  return new Date(d.getTime() + LAGOS_OFFSET_MS);
}

/** Start of the Lagos calendar day containing `d`, as a real instant. */
export function lagosStartOfDay(d: Date): Date {
  const w = lagosWall(d);
  const startWall = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate());
  return new Date(startWall - LAGOS_OFFSET_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Monday 00:00 Lagos of the week containing `d`. */
export function lagosStartOfWeek(d: Date): Date {
  const start = lagosStartOfDay(d);
  const dow = lagosWall(start).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  return addDays(start, -sinceMonday);
}

/** "2026-11-05" in Lagos. */
export function lagosDateString(d: Date): string {
  return lagosWall(d).toISOString().slice(0, 10);
}

/** Parse "2026-11-05" as the start of that Lagos day. */
export function parseLagosDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(t)) return null;
  return new Date(t - LAGOS_OFFSET_MS);
}

/** Minutes after Lagos midnight, 0–1439. */
export function lagosMinuteOfDay(d: Date): number {
  const w = lagosWall(d);
  return w.getUTCHours() * 60 + w.getUTCMinutes();
}

export function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatHHMM(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3:45 PM" */
export function formatLagosClock(d: Date): string {
  const w = lagosWall(d);
  const h24 = w.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(w.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "Thu 5 Nov" */
export function formatLagosDay(d: Date): string {
  const w = lagosWall(d);
  return `${DAYS[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}`;
}

/** "3:45 PM, Thu 5 Nov" */
export function formatLagosDateTime(d: Date): string {
  return `${formatLagosClock(d)}, ${formatLagosDay(d)}`;
}

/** "Friday" if within the next 6 days, else "Fri 13 Nov". "today" / "tomorrow" when applicable. */
export function formatDueDay(due: Date, now: Date): string {
  const days = Math.round((lagosStartOfDay(due).getTime() - lagosStartOfDay(now).getTime()) / DAY_MS);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) {
    const full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return full[lagosWall(due).getUTCDay()]!;
  }
  return formatLagosDay(due);
}

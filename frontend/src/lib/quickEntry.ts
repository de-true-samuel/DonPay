import { parseNairaInput } from './money';
import { lagosParts } from './time';

export interface QuickEntry {
  name: string;
  phone: string;
  service: string;
  totalKobo: string | null;
  depositKobo: string | null;
  plan: 'FULL' | 'DEPOSIT_BALANCE';
  /** YYYY-MM-DD in Lagos, when the text says when the balance is due. */
  balanceDueDate: string | null;
  /** Things the parser had to guess; the form shows a note for each. */
  assumed: Array<'deposit'>;
}

export const NG_PHONE_RE = /^(?:\+?234|0)[789][01]\d{8}$/;
export const isValidNgPhone = (s: string): boolean => NG_PHONE_RE.test(s.replace(/[\s-]/g, ''));

const PHONE = /(?:\+?234|0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}/;
const MONEY = /(?<![A-Za-z0-9])(₦|ngn|n)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m)?(?![A-Za-z0-9])/gi;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;
const MARKERS = /\b(?:deposit|dep|upfront|advance|initial|total|balance|due)\b/gi;

export interface Money { kobo: string; start: number; end: number; deposit?: boolean }

export function scanMoney(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(MONEY)) {
    const digits = m[2].replace(/,/g, '');
    // A bare small number ("2 layers") is not money. Money has ₦/N, a k/m suffix, or at least 4 digits.
    if (!m[1] && !m[3] && digits.replace(/\..*/, '').length < 4) continue;
    const kobo = parseNairaInput(digits + (m[3] ?? ''));
    if (kobo && BigInt(kobo) > 0n) out.push({ kobo, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

function isDepositAmount(text: string, m: Money): boolean {
  const after = text.slice(m.end, m.end + 18).toLowerCase();
  const before = text.slice(Math.max(0, m.start - 16), m.start).toLowerCase();
  return /^\s*(?:as\s+)?(?:a\s+)?(?:deposit|dep\b|upfront|advance|initial)/.test(after)
    || /(?:deposit|upfront|advance)\s*(?:of|is|:|-)?\s*$/.test(before);
}

export function parseDatePhrase(raw: string, now: Date = new Date()): string | null {
  const s = raw.toLowerCase().trim();
  const { y, m, d, dow } = lagosParts(now);
  const base = Date.UTC(y, m, d);
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (/\btoday\b/.test(s)) return fmt(base);
  if (/\b(?:tomorrow|tmrw)\b/.test(s)) return fmt(base + DAY_MS);
  const inN = /\bin\s+(\d{1,2})\s*(day|days|week|weeks|wk|wks)\b/.exec(s);
  if (inN) return fmt(base + Number(inN[1]) * (inN[2].startsWith('w') ? 7 : 1) * DAY_MS);
  if (/\bnext\s+week\b/.test(s)) return fmt(base + 7 * DAY_MS);
  if (/\bmonths?\b/.test(s)) return null;
  const wd = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(s);
  if (wd) {
    let diff = (DAYS.indexOf(wd[1]) - dow + 7) % 7;
    if (diff === 0) diff = 7; // "friday" said on a Friday means next Friday
    return fmt(base + diff * DAY_MS);
  }
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(s);
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s);
  const day = dm ? Number(dm[1]) : md ? Number(md[2]) : null;
  const mon = dm ? MONTHS.indexOf(dm[2]) : md ? MONTHS.indexOf(md[1]) : -1;
  if (day && mon >= 0 && day >= 1 && day <= 31) {
    let cand = Date.UTC(y, mon, day);
    if (cand < base) cand = Date.UTC(y + 1, mon, day); // a past date means next year
    return fmt(cand);
  }
  return null;
}

const tidy = (s: string) => s.replace(/[,;:|]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^(?:for|of|-|–)\s+/i, '').trim();
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Reads a line like "Tolu 0803 123 4567 bridal makeup 50k, 25k deposit, balance friday". Never throws. */
export function parseQuickEntry(input: string, now: Date = new Date()): QuickEntry {
  let text = input.trim();
  let phone = '';
  const pm = PHONE.exec(text);
  if (pm) {
    phone = pm[0].replace(/[\s-]/g, '');
    text = text.slice(0, pm.index) + '\u0000' + text.slice(pm.index + pm[0].length);
  }

  // balance clause: may carry an amount and/or a date
  let balanceMoney: Money[] = [];
  let balanceDueDate: string | null = null;
  const bm = /\bbalance\b[^,;.\u0000]*/i.exec(text);
  if (bm) {
    balanceMoney = scanMoney(bm[0]);
    balanceDueDate = parseDatePhrase(bm[0].replace(/^balance/i, ''), now);
    text = text.slice(0, bm.index) + ' ' + text.slice(bm.index + bm[0].length);
  }
  if (!balanceDueDate) {
    const du = /\bdue\s+([^,;.\u0000]+)/i.exec(text);
    if (du) {
      balanceDueDate = parseDatePhrase(du[1], now);
      if (balanceDueDate) text = text.slice(0, du.index) + ' ' + text.slice(du.index + du[0].length);
    }
  }

  const items = scanMoney(text).map((m) => ({ ...m, deposit: isDepositAmount(text, m) }));
  const deposits = items.filter((i) => i.deposit);
  const plain = items.filter((i) => !i.deposit).sort((a, b) => (BigInt(b.kobo) > BigInt(a.kobo) ? 1 : -1));

  let totalKobo: string | null = null;
  let depositKobo: string | null = null;
  const assumed: QuickEntry['assumed'] = [];
  if (deposits.length) depositKobo = deposits[0].kobo;
  if (plain.length) totalKobo = plain[0].kobo;
  if (!deposits.length && plain.length >= 2) { depositKobo = plain[1].kobo; assumed.push('deposit'); }
  if (!totalKobo && depositKobo && balanceMoney.length) {
    totalKobo = (BigInt(depositKobo) + BigInt(balanceMoney[0].kobo)).toString();
  }
  if (depositKobo && totalKobo && BigInt(depositKobo) >= BigInt(totalKobo)) depositKobo = null;

  // strip the money, marker words and punctuation to leave names and service words
  for (const m of [...items].sort((a, b) => b.start - a.start)) text = text.slice(0, m.start) + ' ' + text.slice(m.end);
  text = text.replace(MARKERS, ' ');
  const [beforeRaw, afterRaw = ''] = text.split('\u0000');
  const before = tidy(beforeRaw);
  const after = tidy(afterRaw);

  let name = '';
  let service = '';
  if (pm && after) { name = before; service = after; }
  else {
    const words = tidy(`${before} ${after}`).split(' ').filter(Boolean);
    name = words[0] ?? '';
    service = words.slice(1).join(' ');
    if (pm && before.split(' ').length > 1) { name = before.split(' ')[0]; service = [before.split(' ').slice(1).join(' '), after].filter(Boolean).join(' '); }
  }
  if (pm && !name && after) { const w = after.split(' '); name = w[0]; service = w.slice(1).join(' '); }

  return {
    name: titleCase(name), phone, service: capFirst(service), totalKobo, depositKobo,
    plan: depositKobo ? 'DEPOSIT_BALANCE' : 'FULL', balanceDueDate, assumed,
  };
}

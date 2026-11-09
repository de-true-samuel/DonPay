import type { Deps } from '../deps';
import { computeJobFinancials } from '../domain/job';
import { formatNairaShort } from '../domain/money';
import { normalizeNigerianPhone, phoneSearchDigits } from '../domain/phone';
import { kindLabel } from '../domain/messages';
import { AppError, notFound, validation } from '../errors';
import type { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from '../db/client';
import { jobInclude, toCustomer, toJobSummary } from './serialize';
import type * as C from '../shared/contract';

const summaryInclude = {
  jobs: {
    select: {
      totalKobo: true,
      plan: true,
      depositKobo: true,
      readyRule: true,
      cancelledAt: true,
      createdAt: true,
      payments: { select: { amountKobo: true, source: true, receivedAt: true } },
    },
  },
} as const satisfies Prisma.CustomerInclude;

type CustomerWithJobs = Prisma.CustomerGetPayload<{ include: typeof summaryInclude }>;

function toCustomerSummary(c: CustomerWithJobs): C.CustomerSummary {
  let outstanding = 0n;
  let last = c.createdAt;
  for (const j of c.jobs) {
    const f = computeJobFinancials({ ...j, payments: j.payments });
    if (!j.cancelledAt && f.balanceKobo > 0n) outstanding += f.balanceKobo;
    if (j.createdAt > last) last = j.createdAt;
    for (const p of j.payments) if (p.receivedAt > last) last = p.receivedAt;
  }
  return { ...toCustomer(c), jobCount: c.jobs.length, outstandingKobo: outstanding.toString(), lastActivityAt: last.toISOString() };
}

export async function listCustomers(deps: Deps, providerId: string, opts: { q?: string; limit: number; cursor?: string }): Promise<C.Page<C.CustomerSummary>> {
  const q = opts.q?.trim();
  const digits = q ? phoneSearchDigits(q) : '';
  const where: Prisma.CustomerWhereInput = {
    providerId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            ...(digits.length >= 3 ? [{ phoneE164: { contains: digits } }] : []),
          ],
        }
      : {}),
  };
  const rows = await deps.db.customer.findMany({
    where,
    include: summaryInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > opts.limit;
  const items = rows.slice(0, opts.limit);
  return { items: items.map(toCustomerSummary), nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function createCustomer(
  deps: Deps,
  providerId: string,
  input: { name: string; phone: string; messageConsent?: boolean },
): Promise<C.Customer> {
  const phone = normalizeNigerianPhone(input.phone);
  if (!phone) throw validation('Enter a valid Nigerian phone number', 'phone');
  const existing = await deps.db.customer.findUnique({ where: { providerId_phoneE164: { providerId, phoneE164: phone } } });
  if (existing) throw new AppError('CONFLICT', 'A customer with this phone number already exists', { existingId: existing.id });
  try {
    const c = await deps.db.customer.create({
      data: { providerId, name: input.name.trim(), phoneE164: phone, messageConsent: input.messageConsent ?? false },
    });
    return toCustomer(c);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'A customer with this phone number already exists');
    throw err;
  }
}

export async function updateCustomer(
  deps: Deps,
  providerId: string,
  id: string,
  patch: { name?: string; phone?: string; messageConsent?: boolean },
): Promise<C.Customer> {
  const c = await deps.db.customer.findFirst({ where: { id, providerId } });
  if (!c) throw notFound('Customer');
  let phone: string | undefined;
  if (patch.phone !== undefined) {
    phone = normalizeNigerianPhone(patch.phone) ?? undefined;
    if (!phone) throw validation('Enter a valid Nigerian phone number', 'phone');
  }
  try {
    const updated = await deps.db.customer.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(phone ? { phoneE164: phone } : {}),
        ...(patch.messageConsent !== undefined ? { messageConsent: patch.messageConsent } : {}),
      },
    });
    return toCustomer(updated);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'Another customer already has this phone number');
    throw err;
  }
}

export async function getCustomerPage(deps: Deps, providerId: string, id: string): Promise<C.CustomerPage> {
  const c = await deps.db.customer.findFirst({ where: { id, providerId }, include: summaryInclude });
  if (!c) throw notFound('Customer');
  const jobs = await deps.db.job.findMany({ where: { customerId: id, providerId }, include: jobInclude, orderBy: { createdAt: 'desc' } });
  const jobIds = jobs.map((j) => j.id);
  const [requests, payments] = await Promise.all([
    deps.db.paymentRequest.findMany({ where: { jobId: { in: jobIds } } }),
    deps.db.payment.findMany({ where: { jobId: { in: jobIds } }, include: { request: { select: { kind: true } } } }),
  ]);
  const service = new Map(jobs.map((j) => [j.id, j.service]));
  const timeline: C.TimelineEvent[] = [];
  const ev = (e: Omit<C.TimelineEvent, 'service' | 'requestId' | 'paymentId' | 'amountKobo'> & Partial<C.TimelineEvent>) =>
    timeline.push({ requestId: null, paymentId: null, amountKobo: null, service: service.get(e.jobId) ?? '', ...e });

  for (const j of jobs) {
    ev({ type: 'JOB_CREATED', at: j.createdAt.toISOString(), jobId: j.id, amountKobo: j.totalKobo.toString(), label: `Job created: ${j.service} (${formatNairaShort(j.totalKobo)})` });
    if (j.cancelledAt) ev({ type: 'JOB_CANCELLED', at: j.cancelledAt.toISOString(), jobId: j.id, label: `Job cancelled: ${j.service}` });
  }
  for (const r of requests) {
    const label = `${kindLabel(r.kind)} ${formatNairaShort(r.amountKobo)}`;
    const base = { jobId: r.jobId, requestId: r.id, amountKobo: r.amountKobo.toString() };
    if (r.sentAt) ev({ ...base, type: 'REQUEST_SENT', at: r.sentAt.toISOString(), label: `Request sent: ${label}` });
    if (r.expiredAt) ev({ ...base, type: 'REQUEST_EXPIRED', at: r.expiredAt.toISOString(), label: `Request expired: ${label}` });
    if (r.cancelledAt) ev({ ...base, type: 'REQUEST_CANCELLED', at: r.cancelledAt.toISOString(), label: `Request cancelled: ${label}` });
  }
  for (const p of payments) {
    const base = { jobId: p.jobId, requestId: p.requestId, paymentId: p.id, amountKobo: p.amountKobo.toString(), at: p.receivedAt.toISOString() };
    if (p.source === 'MANUAL') ev({ ...base, type: 'MANUAL_PAYMENT', label: `${formatNairaShort(p.amountKobo)} recorded manually (not verified by Kora)` });
    else ev({ ...base, type: 'PAYMENT_RECEIVED', label: `${p.request ? `${kindLabel(p.request.kind)} ` : ''}${formatNairaShort(p.amountKobo)} paid` });
  }
  timeline.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { customer: toCustomerSummary(c), jobs: jobs.map((j) => toJobSummary(deps.config, j)), timeline };
}

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export async function importCustomers(deps: Deps, providerId: string, csv: string): Promise<C.ImportResult> {
  const rows = parseCsv(csv);
  if (!rows.length) throw validation('The CSV is empty', 'csv');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf('name');
  const phoneIdx = header.indexOf('phone');
  const consentIdx = header.indexOf('consent');
  if (nameIdx < 0 || phoneIdx < 0) throw validation('The first row must be a header with "name" and "phone" columns', 'csv');
  if (rows.length > 5001) throw validation('Import at most 5,000 customers at a time', 'csv');

  const result: C.ImportResult = { created: 0, skipped: 0, errors: [] };
  const valid: { name: string; phoneE164: string; messageConsent: boolean }[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = (r[nameIdx] ?? '').trim();
    const phone = normalizeNigerianPhone(r[phoneIdx] ?? '');
    if (!name) return result.errors.push({ line, message: 'Missing name' });
    if (!phone) return result.errors.push({ line, message: `Invalid phone "${r[phoneIdx] ?? ''}"` });
    if (seen.has(phone)) {
      result.skipped++;
      return;
    }
    seen.add(phone);
    const consentRaw = consentIdx >= 0 ? (r[consentIdx] ?? '').trim().toLowerCase() : '';
    valid.push({ name, phoneE164: phone, messageConsent: ['yes', 'y', 'true', '1'].includes(consentRaw) });
  });
  const { count } = await deps.db.customer.createMany({ data: valid.map((v) => ({ ...v, providerId })), skipDuplicates: true });
  result.created = count;
  result.skipped += valid.length - count;
  return result;
}

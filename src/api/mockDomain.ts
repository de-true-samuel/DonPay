/**
 * Mock of the jobs / requests / today endpoints (contract §5–§8) so the whole core loop
 * works with no backend. Behaviour follows the contract; numbers like the 60-minute account
 * validity are stand-ins for what the real backend decides.
 */
import { z } from 'zod';
import type {
  Customer, CustomerSummary, ErrorCode, JobDetail, JobSummary, Payment, PaymentPlan, PaymentRequest,
  PreparedMessage, Provider, ReadyRule, RequestWithMessage, ReviewItem, TimelineEvent, TodayResponse,
} from '../contract/contract';
import { parseConsent, parseCsv } from '../lib/csv';
import { KIND_LABEL } from '../lib/labels';
import { formatNaira } from '../lib/money';
import { scanMoney } from '../lib/quickEntry';
import { formatDateTime, isoToLagosDate } from '../lib/time';

export interface RawJob {
  id: string; customerId: string; service: string; totalKobo: string; plan: PaymentPlan;
  depositKobo: string | null; balanceDueAt: string | null; readyRule: ReadyRule; notes: string | null;
  createdAt: string; cancelledAt: string | null;
}
export interface DomainDb {
  customers: Customer[]; jobs: RawJob[]; requests: PaymentRequest[]; payments: Payment[]; reviews: ReviewItem[]; seq: number;
}
export const emptyDomain = (): DomainDb => ({ customers: [], jobs: [], requests: [], payments: [], reviews: [], seq: 0 });

/* ---------- http helpers ---------- */
const rid = () => 'mock-' + Math.random().toString(36).slice(2, 8);
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': rid() } });
export const fail = (status: number, code: ErrorCode, message: string, details?: unknown) =>
  json(status, { error: { code, message, details } });

/* ---------- small utils ---------- */
const MIN = 60_000;
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const newest = <T extends { createdAt: string }>(a: T, b: T) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
const id = (d: DomainDb, p: string) => `${p}_${(++d.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const OPEN = ['DRAFT', 'SCHEDULED', 'SENT'];
const lagosMidnight = () => {
  const s = new Date(Date.now() + 3_600_000);
  return Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - 3_600_000;
};

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (/^234[789][01]\d{8}$/.test(digits)) return '+' + digits;
  if (/^0[789][01]\d{8}$/.test(digits)) return '+234' + digits.slice(1);
  if (/^[789][01]\d{8}$/.test(digits)) return '+234' + digits;
  return null;
}

function expireStale(d: DomainDb): void {
  for (const r of d.requests) {
    if (r.status === 'SENT' && r.expiresAt && Date.parse(r.expiresAt) <= Date.now()) r.status = 'EXPIRED';
  }
}

/* ---------- derived views ---------- */
function summarize(d: DomainDb, job: RawJob): JobSummary {
  const customer = d.customers.find((c) => c.id === job.customerId)!;
  const pays = d.payments.filter((p) => p.jobId === job.id);
  const sum = (list: Payment[]) => list.reduce((a, p) => a + BigInt(p.amountKobo), 0n);
  const paid = sum(pays);
  const verified = sum(pays.filter((p) => p.source === 'KORA_VERIFIED'));
  const total = BigInt(job.totalKobo);
  const cancelled = !!job.cancelledAt;
  const need = job.readyRule === 'AFTER_DEPOSIT' && job.depositKobo ? BigInt(job.depositKobo) : total;
  const open = d.requests.filter((r) => r.jobId === job.id && OPEN.includes(r.status)).sort(newest)[0] ?? null;
  return {
    id: job.id, customer: { id: customer.id, name: customer.name, phone: customer.phone },
    service: job.service, totalKobo: job.totalKobo, plan: job.plan, depositKobo: job.depositKobo,
    balanceDueAt: job.balanceDueAt, readyRule: job.readyRule, notes: job.notes,
    status: cancelled ? 'CANCELLED' : paid >= total ? 'FULLY_PAID' : paid > 0n ? 'PART_PAID' : 'NOT_STARTED',
    paidKobo: paid.toString(), verifiedPaidKobo: verified.toString(), balanceKobo: (total - paid).toString(),
    readyToStart: !cancelled && verified >= need,
    hasUnverifiedPayments: pays.some((p) => p.source === 'MANUAL'),
    openRequest: open, createdAt: job.createdAt, cancelledAt: job.cancelledAt,
  };
}

function detail(d: DomainDb, job: RawJob): JobDetail {
  return {
    ...summarize(d, job),
    requests: d.requests.filter((r) => r.jobId === job.id).sort(newest),
    payments: d.payments.filter((p) => p.jobId === job.id).sort(newest),
    openReviewItems: d.reviews.filter((r) => r.jobId === job.id && !r.resolvedAt),
  };
}

function prepare(d: DomainDb, provider: Provider, req: PaymentRequest): PreparedMessage {
  const job = d.jobs.find((j) => j.id === req.jobId)!;
  const cust = d.customers.find((c) => c.id === job.customerId)!;
  const kind = req.kind === 'DEPOSIT' ? ' (deposit)' : req.kind === 'BALANCE' ? ' (balance)' : '';
  const link = req.payLink;
  const text = [
    `Hi ${cust.name.split(' ')[0]}, here are the payment details from ${provider.businessName} for ${job.service}${kind}:`,
    '',
    `Amount: ${formatNaira(req.amountKobo)} (pay this exact amount)`,
    `Bank: ${req.bankName}`,
    `Account number: ${req.accountNumber}`,
    `Account name: ${req.accountName}`,
    `Valid until: ${req.expiresAt ? formatDateTime(req.expiresAt) : ''}`,
    '',
    `This account is for this payment only. Details & receipt:`,
    link,
  ].join('\n');
  return shareLinks(text, cust.phone, link);
}

function shareLinks(text: string, phone: string, link: string): PreparedMessage {
  return {
    text, payLink: link,
    whatsappUrl: `https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(text)}`,
    telegramUrl: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
  };
}

const withMsg = (d: DomainDb, p: Provider, r: PaymentRequest, message: boolean): RequestWithMessage => ({
  request: r, job: summarize(d, d.jobs.find((j) => j.id === r.jobId)!), message: message ? prepare(d, p, r) : null,
});

function allocate(p: Provider, r: PaymentRequest): void {
  r.bankName = 'Wema Bank';
  r.accountNumber = '78' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  r.accountName = p.businessName;
  r.sentAt = iso(Date.now());
  r.expiresAt = iso(Date.now() + 60 * MIN); // stand-in: the real backend decides the validity window
  r.status = 'SENT';
}

function makeRequest(d: DomainDb, job: RawJob, kind: PaymentRequest['kind'], amountKobo: string): PaymentRequest {
  const token = Math.random().toString(36).slice(2, 8);
  const r: PaymentRequest = {
    id: id(d, 'req'), jobId: job.id, kind, amountKobo, status: 'DRAFT', payLink: `https://paidar.example/p/${token}`,
    bankName: null, accountNumber: null, accountName: null, expiresAt: null, scheduledFor: null,
    sentAt: null, paidAt: null, createdAt: iso(Date.now()),
  };
  d.requests.push(r);
  return r;
}

/* ---------- customers, paging and timelines ---------- */
function paginate<T>(items: T[], sp: URLSearchParams): { items: T[]; nextCursor: string | null } {
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 20) || 20));
  const offset = Number(sp.get('cursor') ?? 0) || 0;
  return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? String(offset + limit) : null };
}

function custSummary(d: DomainDb, c: Customer): CustomerSummary {
  const jobs = d.jobs.filter((j) => j.customerId === c.id);
  const ids = new Set(jobs.map((j) => j.id));
  const owed = jobs.map((j) => summarize(d, j)).filter((s) => s.status !== 'CANCELLED' && BigInt(s.balanceKobo) > 0n)
    .reduce((a, s) => a + BigInt(s.balanceKobo), 0n);
  const times = [
    c.createdAt, ...jobs.map((j) => j.createdAt),
    ...d.payments.filter((p) => ids.has(p.jobId)).map((p) => p.receivedAt),
    ...d.requests.filter((r) => ids.has(r.jobId)).map((r) => r.sentAt ?? r.createdAt),
  ].map((t) => Date.parse(t));
  return { ...c, jobCount: jobs.length, outstandingKobo: owed.toString(), lastActivityAt: iso(Math.max(...times)) };
}

function timeline(d: DomainDb, jobs: RawJob[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const j of jobs) {
    const base = { jobId: j.id, service: j.service };
    out.push({ ...base, type: 'JOB_CREATED', at: j.createdAt, requestId: null, paymentId: null, amountKobo: j.totalKobo, label: `${j.service} job created` });
    for (const r of d.requests.filter((x) => x.jobId === j.id)) {
      const k = KIND_LABEL[r.kind];
      if (r.sentAt) out.push({ ...base, type: 'REQUEST_SENT', at: r.sentAt, requestId: r.id, paymentId: null, amountKobo: r.amountKobo, label: `${k} ${formatNaira(r.amountKobo, 'auto')} sent` });
      if (r.status === 'EXPIRED' && r.expiresAt) out.push({ ...base, type: 'REQUEST_EXPIRED', at: r.expiresAt, requestId: r.id, paymentId: null, amountKobo: r.amountKobo, label: `${k} ${formatNaira(r.amountKobo, 'auto')} expired` });
      if (r.status === 'CANCELLED') out.push({ ...base, type: 'REQUEST_CANCELLED', at: r.sentAt ?? r.createdAt, requestId: r.id, paymentId: null, amountKobo: r.amountKobo, label: `${k} request cancelled` });
    }
    for (const p of d.payments.filter((x) => x.jobId === j.id)) {
      const manual = p.source === 'MANUAL';
      const r = d.requests.find((x) => x.id === p.requestId);
      out.push({
        ...base, type: manual ? 'MANUAL_PAYMENT' : 'PAYMENT_RECEIVED', at: p.receivedAt, requestId: p.requestId, paymentId: p.id, amountKobo: p.amountKobo,
        label: manual ? `${formatNaira(p.amountKobo, 'auto')} recorded by you` : `${r ? KIND_LABEL[r.kind] : 'Payment'} ${formatNaira(p.amountKobo, 'auto')} paid`,
      });
    }
    if (j.cancelledAt) out.push({ ...base, type: 'JOB_CANCELLED', at: j.cancelledAt, requestId: null, paymentId: null, amountKobo: null, label: `${j.service} job cancelled` });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/* ---------- search, review, export ---------- */
const lagosDow = () => new Date(Date.now() + 3_600_000).getUTCDay();
const naira = (k: string) => `${BigInt(k) / 100n}.${(BigInt(k) % 100n).toString().padStart(2, '0')}`;
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function interpret(raw: string): { text: string | null; phone: string | null; amountKobo: string | null; sig: string | null } {
  let rest = raw;
  let phone: string | null = null;
  let sig: string | null = null;
  const pm = /(?:\+?234|\b0)[\d\s-]{2,13}\d/.exec(rest);
  if (pm) {
    const digits = pm[0].replace(/\D/g, '');
    sig = digits.replace(/^234/, '').replace(/^0/, '');
    phone = normalizePhone(pm[0]) ?? digits;
    rest = rest.slice(0, pm.index) + ' ' + rest.slice(pm.index + pm[0].length);
  }
  let amountKobo: string | null = null;
  const money = scanMoney(rest);
  if (money.length) {
    amountKobo = money[0].kobo;
    for (const m of [...money].sort((a, b) => b.start - a.start)) rest = rest.slice(0, m.start) + ' ' + rest.slice(m.end);
  }
  const text = rest.replace(/\s+/g, ' ').trim();
  return { text: text || null, phone, amountKobo, sig };
}

function runSearch(d: DomainDb, sp: URLSearchParams) {
  expireStale(d);
  const it = interpret((sp.get('q') ?? '').trim());
  const statuses = (sp.get('status') ?? '').split(',').filter(Boolean);
  const view = sp.get('view');
  const from = sp.get('from') ? Date.parse(`${sp.get('from')}T00:00:00+01:00`) : null;
  const to = sp.get('to') ? Date.parse(`${sp.get('to')}T23:59:59.999+01:00`) : null;
  const weekStart = lagosMidnight() - ((lagosDow() + 6) % 7) * DAY;
  const endTomorrow = lagosMidnight() + 2 * DAY - 1;
  const words = (it.text ?? '').toLowerCase().split(' ').filter(Boolean);

  const items = d.jobs.map((job) => {
    const s = summarize(d, job);
    const cust = d.customers.find((c) => c.id === job.customerId)!;
    const reqs = d.requests.filter((r) => r.jobId === job.id);
    const pays = d.payments.filter((p) => p.jobId === job.id);
    const reviewOpen = d.reviews.some((r) => r.jobId === job.id && !r.resolvedAt);
    const expired = !s.openRequest && reqs.some((r) => r.status === 'EXPIRED');
    const owes = s.status !== 'CANCELLED' && BigInt(s.balanceKobo) > 0n;
    const chips: Record<string, boolean> = {
      paid: pays.length > 0, waiting: s.openRequest?.status === 'SENT',
      balance_due: owes && pays.length > 0, expired, needs_review: reviewOpen,
    };
    return { job, s, cust, reqs, pays, chips, reviewOpen, expired, owes };
  }).filter((x) => {
    const hay = `${x.cust.name} ${x.job.service}`.toLowerCase();
    if (words.some((w) => !hay.includes(w))) return false;
    if (it.sig && !x.cust.phone.includes(it.sig)) return false;
    if (it.amountKobo) {
      const a = it.amountKobo;
      const hit = [x.job.totalKobo, x.job.depositKobo, x.s.balanceKobo].includes(a)
        || x.reqs.some((r) => r.amountKobo === a) || x.pays.some((p) => p.amountKobo === a);
      if (!hit) return false;
    }
    if (statuses.length && !statuses.some((c) => x.chips[c])) return false;
    if (from !== null || to !== null) {
      const times = [Date.parse(x.job.createdAt), ...x.pays.map((p) => Date.parse(p.receivedAt))];
      if (!times.some((t) => (from === null || t >= from) && (to === null || t <= to))) return false;
    }
    if (view === 'unpaid_balances' && !(['NOT_STARTED', 'PART_PAID'].includes(x.s.status))) return false;
    if (view === 'this_week') {
      const times = [Date.parse(x.job.createdAt), ...x.pays.map((p) => Date.parse(p.receivedAt))];
      if (!times.some((t) => t >= weekStart)) return false;
    }
    if (view === 'needs_follow_up') {
      const due = x.owes && !x.s.openRequest && !!x.job.balanceDueAt && Date.parse(x.job.balanceDueAt) <= endTomorrow;
      if (!(due || x.expired || x.reviewOpen)) return false;
    }
    return true;
  }).map((x) => x.s).sort(newest);

  return { ...paginate(items, sp), interpreted: { text: it.text, phone: it.phone, amountKobo: it.amountKobo } };
}

function exportCsv(d: DomainDb, sp: URLSearchParams): Response {
  const from = sp.get('from'), to = sp.get('to');
  const head = 'date,customer,phone,service,request_kind,amount_naira,source,payer_name,kora_reference,job_total_naira,job_balance_naira';
  const rows = d.payments.filter((p) => {
    const day = isoToLagosDate(p.receivedAt);
    return (!from || day >= from) && (!to || day <= to);
  }).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)).map((p) => {
    const job = d.jobs.find((j) => j.id === p.jobId)!;
    const cust = d.customers.find((c) => c.id === job.customerId)!;
    const s = summarize(d, job);
    const r = d.requests.find((x) => x.id === p.requestId);
    return [
      isoToLagosDate(p.receivedAt), cust.name, cust.phone, job.service, r?.kind ?? 'MANUAL', naira(p.amountKobo),
      p.source, p.payerName ?? '', p.source === 'KORA_VERIFIED' ? `KORA-${p.id}` : '', naira(job.totalKobo), naira(s.balanceKobo),
    ].map(cell).join(',');
  });
  return new Response([head, ...rows].join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="paidar-payments-${from || 'start'}-to-${to || 'today'}.csv"`,
      'x-request-id': rid(),
    },
  });
}

const vfail = (fe: Record<string, string[]>) => fail(400, 'VALIDATION_ERROR', 'Invalid body.', { fieldErrors: fe, formErrors: [] });

/* ---------- validation ---------- */
const CreateJob = z.object({
  customerId: z.string().optional(),
  customer: z.object({
    name: z.string().trim().min(1, 'Enter the customer’s name').max(80),
    phone: z.string().min(1, 'Enter a phone number'),
    messageConsent: z.boolean().optional(),
  }).optional(),
  service: z.string().trim().min(1, 'Describe the service').max(120, 'Keep it under 120 characters'),
  totalKobo: z.string().regex(/^\d+$/, 'Enter an amount').refine((v) => BigInt(v) > 0n, 'Must be more than zero'),
  plan: z.enum(['FULL', 'DEPOSIT_BALANCE']),
  depositKobo: z.string().regex(/^\d+$/, 'Enter an amount').optional(),
  balanceDueAt: z.string().nullable().optional(),
  readyRule: z.enum(['AFTER_DEPOSIT', 'AFTER_FULL']).optional(),
  notes: z.string().max(500).optional(),
});

/* ---------- router ---------- */
export function handleDomain(
  method: string, path: string, sp: URLSearchParams, body: unknown, provider: Provider, d: DomainDb,
): Response | null {
  expireStale(d);
  let m: RegExpExecArray | null;
  const jobOf = (jid: string) => d.jobs.find((j) => j.id === jid);
  const reqOf = (rid_: string) => d.requests.find((r) => r.id === rid_);

  if (method === 'GET' && path === '/api/today') return json(200, today(d));

  if (method === 'GET' && path === '/api/jobs') {
    const status = sp.get('status');
    const list = d.jobs.map((j) => summarize(d, j)).filter((j) => !status || j.status === status).sort(newest);
    return json(200, paginate(list, sp));
  }

  if (method === 'POST' && path === '/api/jobs') {
    const parsed = CreateJob.safeParse(body);
    const fe: Record<string, string[]> = {};
    const add = (k: string, msg: string) => { (fe[k] ??= []).push(msg); };
    if (!parsed.success) for (const i of parsed.error.issues) add(i.path.join('.') || '_', i.message);
    const b = parsed.success ? parsed.data : null;
    let phone: string | null = null;
    if (b) {
      if (!b.customerId && !b.customer) add('customer', 'Add the customer’s name and phone');
      if (b.customer) {
        phone = normalizePhone(b.customer.phone);
        if (!phone) add('customer.phone', 'Enter a Nigerian number like 0803 123 4567');
      }
      if (b.plan === 'DEPOSIT_BALANCE') {
        if (!b.depositKobo) add('depositKobo', 'Enter the deposit');
        else if (BigInt(b.depositKobo) <= 0n || BigInt(b.depositKobo) >= BigInt(b.totalKobo)) add('depositKobo', 'The deposit must be less than the total');
      }
    }
    if (!b || Object.keys(fe).length) return fail(400, 'VALIDATION_ERROR', 'Invalid body.', { fieldErrors: fe, formErrors: [] });

    let cust = b.customerId ? d.customers.find((c) => c.id === b.customerId) : d.customers.find((c) => c.phone === phone);
    if (b.customerId && !cust) return fail(404, 'NOT_FOUND', 'Customer not found.');
    if (!cust && b.customer && phone) {
      cust = { id: id(d, 'cus'), name: b.customer.name, phone, messageConsent: !!b.customer.messageConsent, createdAt: iso(Date.now()) };
      d.customers.push(cust);
    }
    const job: RawJob = {
      id: id(d, 'job'), customerId: cust!.id, service: b.service, totalKobo: b.totalKobo, plan: b.plan,
      depositKobo: b.plan === 'DEPOSIT_BALANCE' ? b.depositKobo ?? null : null,
      balanceDueAt: b.plan === 'DEPOSIT_BALANCE' ? b.balanceDueAt ?? null : null,
      readyRule: b.readyRule ?? provider.defaultReadyRule, notes: b.notes ?? null,
      createdAt: iso(Date.now()), cancelledAt: null,
    };
    d.jobs.push(job);
    makeRequest(d, job, job.plan === 'FULL' ? 'FULL' : 'DEPOSIT', job.plan === 'FULL' ? job.totalKobo : job.depositKobo!);
    return json(201, detail(d, job));
  }

  if ((m = /^\/api\/jobs\/([^/]+)$/.exec(path)) && method === 'GET') {
    const job = jobOf(m[1]);
    return job ? json(200, detail(d, job)) : fail(404, 'NOT_FOUND', 'Job not found.');
  }

  if ((m = /^\/api\/jobs\/([^/]+)\/requests\/balance$/.exec(path)) && method === 'POST') {
    const job = jobOf(m[1]);
    if (!job) return fail(404, 'NOT_FOUND', 'Job not found.');
    const s = summarize(d, job);
    if (job.cancelledAt) return fail(409, 'INVALID_STATE', 'This job is cancelled.');
    if (BigInt(s.balanceKobo) <= 0n) return fail(409, 'NOTHING_OWED', 'Nothing is owed on this job.');
    if (s.openRequest) return fail(409, 'OPEN_REQUEST_EXISTS', 'This job already has an open request.', { requestId: s.openRequest.id });
    const r = makeRequest(d, job, 'BALANCE', s.balanceKobo); // amount computed here, never by the client
    const send = !!(body as { send?: boolean } | undefined)?.send;
    if (send) allocate(provider, r);
    return json(201, withMsg(d, provider, r, send));
  }

  if ((m = /^\/api\/requests\/([^/]+)\/(send|schedule|cancel|resend)$/.exec(path)) && method === 'POST') {
    const r = reqOf(m[1]);
    if (!r) return fail(404, 'NOT_FOUND', 'Request not found.');
    const bad = () => fail(409, 'INVALID_STATE', `A ${r.status.toLowerCase()} request can’t do that.`);
    switch (m[2]) {
      case 'send':
        if (r.status === 'SENT') return json(200, withMsg(d, provider, r, true)); // safe to retry
        if (r.status !== 'DRAFT' && r.status !== 'SCHEDULED') return bad();
        allocate(provider, r);
        return json(200, withMsg(d, provider, r, true));
      case 'schedule': {
        if (r.status !== 'DRAFT') return bad();
        const at = String((body as { scheduledFor?: string } | undefined)?.scheduledFor ?? '');
        if (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now()) {
          return fail(400, 'VALIDATION_ERROR', 'Invalid body.', { fieldErrors: { scheduledFor: ['Pick a time in the future'] }, formErrors: [] });
        }
        r.status = 'SCHEDULED';
        r.scheduledFor = at;
        return json(200, withMsg(d, provider, r, false));
      }
      case 'cancel':
        if (!OPEN.includes(r.status)) return bad();
        r.status = 'CANCELLED';
        return json(200, withMsg(d, provider, r, false));
      default: { // resend
        if (r.status === 'SENT') return json(200, withMsg(d, provider, r, true));
        if (r.status !== 'EXPIRED') return bad();
        const fresh = makeRequest(d, jobOf(r.jobId)!, r.kind, r.amountKobo);
        allocate(provider, fresh);
        return json(200, withMsg(d, provider, fresh, true));
      }
    }
  }

  if ((m = /^\/api\/requests\/([^/]+)\/message$/.exec(path)) && method === 'GET') {
    const r = reqOf(m[1]);
    if (!r) return fail(404, 'NOT_FOUND', 'Request not found.');
    if (r.status !== 'SENT') return fail(409, 'INVALID_STATE', 'Only a sent request has a message.');
    return json(200, prepare(d, provider, r));
  }

  if ((m = /^\/api\/payments\/([^/]+)\/receipt-message$/.exec(path)) && method === 'GET') {
    const p = d.payments.find((x) => x.id === m![1]);
    if (!p) return fail(404, 'NOT_FOUND', 'Payment not found.');
    const job = jobOf(p.jobId)!;
    const s = summarize(d, job);
    const cust = d.customers.find((c) => c.id === job.customerId)!;
    const left = BigInt(s.balanceKobo) > 0n ? ` Balance remaining: ${formatNaira(s.balanceKobo)}.` : ' Fully paid. Thank you!';
    const text = `Hi ${cust.name.split(' ')[0]}, we’ve received ${formatNaira(p.amountKobo)} for ${job.service}.${left}\n— ${provider.businessName}`;
    return json(200, shareLinks(text, cust.phone, `https://paidar.example/receipt/${p.id}`));
  }

  if ((m = /^\/api\/dev\/expire\/([^/]+)$/.exec(path)) && method === 'POST') { // mock-only helper for demos
    const r = reqOf(m[1]);
    if (!r || r.status !== 'SENT') return fail(409, 'INVALID_STATE', 'Only a sent request can be expired.');
    r.expiresAt = iso(Date.now() - 1000);
    r.status = 'EXPIRED';
    return json(200, { outcome: 'recorded', paymentId: null });
  }

  if ((m = /^\/api\/dev\/simulate-payment\/([^/]+)$/.exec(path)) && method === 'POST') {
    const r = reqOf(m[1]);
    if (!r) return fail(404, 'NOT_FOUND', 'Request not found.');
    if (r.status === 'PAID') {
      const p = d.payments.find((x) => x.requestId === r.id);
      return json(200, { outcome: 'duplicate', paymentId: p?.id ?? null });
    }
    const late = r.status === 'EXPIRED'; // mock-only: shows the "paid after expiry" review
    if (r.status !== 'SENT' && !late) return fail(409, 'INVALID_STATE', 'Send the request first.');
    const o = (body ?? {}) as { amountKobo?: string; payerName?: string | null };
    if (o.amountKobo && o.amountKobo !== r.amountKobo) {
      d.reviews.push({
        id: id(d, 'rev'), kind: 'AMOUNT_MISMATCH', jobId: r.jobId, requestId: r.id, paymentId: null, detail: {},
        message: `${formatNaira(o.amountKobo)} arrived for a request of ${formatNaira(r.amountKobo)}.`,
        createdAt: iso(Date.now()), resolvedAt: null, resolution: null,
      });
      return json(200, { outcome: 'recorded', paymentId: null });
    }
    const now = iso(Date.now());
    const pay: Payment = {
      id: id(d, 'pay'), jobId: r.jobId, requestId: r.id, source: 'KORA_VERIFIED', amountKobo: r.amountKobo,
      payerName: o.payerName === undefined ? 'SIMULATED PAYER' : o.payerName, payerBank: 'KORA SANDBOX',
      payerAccountMasked: '******0000', payerDetailsSimulated: true, note: null, receivedAt: now, createdAt: now,
    };
    d.payments.push(pay);
    r.status = 'PAID';
    r.paidAt = now;
    if (late) {
      d.reviews.push({
        id: id(d, 'rev'), kind: 'PAID_AFTER_EXPIRY', jobId: r.jobId, requestId: r.id, paymentId: pay.id, detail: {},
        message: `${formatNaira(r.amountKobo)} arrived after this payment account expired. Check you still want it.`,
        createdAt: now, resolvedAt: null, resolution: null,
      });
    }
    return json(200, { outcome: 'recorded', paymentId: pay.id });
  }



  /* ----- search, review, export ----- */
  if (method === 'GET' && path === '/api/search') return json(200, runSearch(d, sp));
  if (method === 'GET' && path === '/api/export.csv') return exportCsv(d, sp);

  if (method === 'GET' && path === '/api/review') {
    const resolved = sp.get('state') === 'resolved';
    const list = d.reviews.filter((r) => (resolved ? !!r.resolvedAt : !r.resolvedAt))
      .sort((a, b) => Date.parse(resolved ? b.resolvedAt! : b.createdAt) - Date.parse(resolved ? a.resolvedAt! : a.createdAt));
    return json(200, paginate(list, sp));
  }
  if ((m = /^\/api\/review\/([^/]+)\/resolve$/.exec(path)) && method === 'POST') {
    const item = d.reviews.find((r) => r.id === m![1]);
    if (!item) return fail(404, 'NOT_FOUND', 'Review item not found.');
    const b = (body ?? {}) as { resolution?: string; cancelRequestId?: string };
    if (!b.resolution?.trim() || b.resolution.length > 500) return vfail({ resolution: ['Say what you did, in up to 500 characters'] });
    if (!item.resolvedAt) {
      item.resolvedAt = iso(Date.now());
      item.resolution = b.resolution.trim();
      const r = b.cancelRequestId ? reqOf(b.cancelRequestId) : undefined;
      if (r && OPEN.includes(r.status)) r.status = 'CANCELLED';
    }
    return json(200, item);
  }

  /* ----- customers ----- */
  if (method === 'GET' && path === '/api/customers') {
    const q = (sp.get('q') ?? '').trim().toLowerCase();
    const qd = q.replace(/\D/g, '').replace(/^0/, '');
    const list = d.customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && c.phone.includes(qd)))
      .map((c) => custSummary(d, c)).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
    return json(200, paginate(list, sp));
  }

  if (method === 'POST' && path === '/api/customers') {
    const b = (body ?? {}) as { name?: string; phone?: string; messageConsent?: boolean };
    const fe: Record<string, string[]> = {};
    if (!b.name?.trim()) fe.name = ['Enter the customer’s name'];
    const phone = b.phone ? normalizePhone(b.phone) : null;
    if (!phone) fe.phone = ['Enter a Nigerian number like 0803 123 4567'];
    if (Object.keys(fe).length) return vfail(fe);
    const dup = d.customers.find((c) => c.phone === phone);
    if (dup) return fail(409, 'CONFLICT', 'You already have a customer with this number.', { existingId: dup.id });
    const c: Customer = { id: id(d, 'cus'), name: b.name!.trim(), phone: phone!, messageConsent: !!b.messageConsent, createdAt: iso(Date.now()) };
    d.customers.push(c);
    return json(201, c);
  }

  if (method === 'POST' && path === '/api/customers/import') {
    const csv = String((body as { csv?: string } | undefined)?.csv ?? '');
    const rows = parseCsv(csv);
    const head = (rows[0]?.cells ?? []).map((h) => h.toLowerCase());
    const ni = head.indexOf('name'), pi = head.indexOf('phone'), ci = head.indexOf('consent');
    if (ni < 0 || pi < 0) return vfail({ csv: ['The first line must be a header with name and phone'] });
    const result = { created: 0, skipped: 0, errors: [] as Array<{ line: number; message: string }> };
    for (const row of rows.slice(1)) {
      const name = row.cells[ni]?.trim();
      const phone = normalizePhone(row.cells[pi] ?? '');
      if (!name) { result.errors.push({ line: row.line, message: 'Name is empty' }); continue; }
      if (!phone) { result.errors.push({ line: row.line, message: `“${row.cells[pi] ?? ''}” isn’t a Nigerian phone number` }); continue; }
      if (d.customers.some((c) => c.phone === phone)) { result.skipped++; continue; }
      d.customers.push({ id: id(d, 'cus'), name, phone, messageConsent: ci >= 0 && parseConsent(row.cells[ci]), createdAt: iso(Date.now()) });
      result.created++;
    }
    return json(200, result);
  }

  if ((m = /^\/api\/customers\/([^/]+)$/.exec(path))) {
    const c = d.customers.find((x) => x.id === m![1]);
    if (!c) return fail(404, 'NOT_FOUND', 'Customer not found.');
    if (method === 'GET') {
      const jobs = d.jobs.filter((j) => j.customerId === c.id);
      return json(200, { customer: custSummary(d, c), jobs: jobs.map((j) => summarize(d, j)).sort(newest), timeline: timeline(d, jobs) });
    }
    if (method === 'PATCH') {
      const b = (body ?? {}) as { name?: string; phone?: string; messageConsent?: boolean };
      const fe: Record<string, string[]> = {};
      if (b.name !== undefined && !b.name.trim()) fe.name = ['Enter the customer’s name'];
      let phone: string | null = c.phone;
      if (b.phone !== undefined) { phone = normalizePhone(b.phone); if (!phone) fe.phone = ['Enter a Nigerian number like 0803 123 4567']; }
      if (Object.keys(fe).length) return vfail(fe);
      const dup = d.customers.find((x) => x.id !== c.id && x.phone === phone);
      if (dup) return fail(409, 'CONFLICT', 'Another customer already has this number.', { existingId: dup.id });
      if (b.name !== undefined) c.name = b.name.trim();
      c.phone = phone!;
      if (b.messageConsent !== undefined) c.messageConsent = b.messageConsent;
      return json(200, c);
    }
  }

  /* ----- job edits, cancel, manual payments ----- */
  if ((m = /^\/api\/jobs\/([^/]+)$/.exec(path)) && method === 'PATCH') {
    const job = jobOf(m[1]);
    if (!job) return fail(404, 'NOT_FOUND', 'Job not found.');
    if (job.cancelledAt) return fail(409, 'INVALID_STATE', 'This job is cancelled.');
    const b = (body ?? {}) as { service?: string; notes?: string | null; balanceDueAt?: string | null; readyRule?: ReadyRule };
    const fe: Record<string, string[]> = {};
    if (b.service !== undefined && (!b.service.trim() || b.service.trim().length > 120)) fe.service = ['Use 1 to 120 characters'];
    if (b.balanceDueAt && !Number.isFinite(Date.parse(b.balanceDueAt))) fe.balanceDueAt = ['Pick a valid date'];
    if (b.readyRule !== undefined && !['AFTER_DEPOSIT', 'AFTER_FULL'].includes(b.readyRule)) fe.readyRule = ['Choose one of the options'];
    if (Object.keys(fe).length) return vfail(fe);
    if (b.service !== undefined) job.service = b.service.trim();
    if (b.notes !== undefined) job.notes = b.notes?.trim() || null;
    if (b.balanceDueAt !== undefined) job.balanceDueAt = b.balanceDueAt;
    if (b.readyRule !== undefined) job.readyRule = b.readyRule;
    return json(200, detail(d, job));
  }

  if ((m = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(path)) && method === 'POST') {
    const job = jobOf(m[1]);
    if (!job) return fail(404, 'NOT_FOUND', 'Job not found.');
    if (!job.cancelledAt) {
      for (const r of d.requests) if (r.jobId === job.id && OPEN.includes(r.status)) r.status = 'CANCELLED';
      job.cancelledAt = iso(Date.now());
    }
    return json(200, detail(d, job));
  }

  if ((m = /^\/api\/jobs\/([^/]+)\/payments\/manual$/.exec(path)) && method === 'POST') {
    const job = jobOf(m[1]);
    if (!job) return fail(404, 'NOT_FOUND', 'Job not found.');
    if (job.cancelledAt) return fail(409, 'INVALID_STATE', 'This job is cancelled.');
    const b = (body ?? {}) as { amountKobo?: string; note?: string; receivedAt?: string };
    const fe: Record<string, string[]> = {};
    if (!b.amountKobo || !/^\d+$/.test(b.amountKobo) || BigInt(b.amountKobo) <= 0n) fe.amountKobo = ['Enter an amount above zero'];
    if (b.note && b.note.length > 200) fe.note = ['Keep it under 200 characters'];
    if (b.receivedAt && (!Number.isFinite(Date.parse(b.receivedAt)) || Date.parse(b.receivedAt) > Date.now() + MIN)) fe.receivedAt = ['The time can’t be in the future'];
    if (Object.keys(fe).length) return vfail(fe);
    const at = b.receivedAt ? new Date(b.receivedAt).toISOString() : iso(Date.now());
    const pay: Payment = {
      id: id(d, 'pay'), jobId: job.id, requestId: null, source: 'MANUAL', amountKobo: b.amountKobo!, payerName: null, payerBank: null,
      payerAccountMasked: null, payerDetailsSimulated: false, note: b.note?.trim() || null, receivedAt: at, createdAt: iso(Date.now()),
    };
    d.payments.push(pay);
    return json(201, pay);
  }

  return null;
}

function today(d: DomainDb): TodayResponse {
  const midnight = lagosMidnight();
  const jobs = d.jobs.map((j) => summarize(d, j));
  const jobById = (jid: string) => jobs.find((j) => j.id === jid)!;
  const justPaid = d.payments.filter((p) => Date.parse(p.receivedAt) >= midnight)
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .map((payment) => ({ payment, job: jobById(payment.jobId) }));
  const waiting = d.requests.filter((r) => r.status === 'SENT')
    .sort((a, b) => Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!))
    .map((request) => ({ request, job: jobById(request.jobId) }));
  const endTomorrow = midnight + 2 * DAY - 1;
  const balancesDue = jobs.filter((j) => j.status !== 'CANCELLED' && BigInt(j.balanceKobo) > 0n && !j.openRequest
    && j.balanceDueAt && Date.parse(j.balanceDueAt) <= endTomorrow);
  const seen = new Set<string>();
  const expired = d.requests.filter((r) => r.status === 'EXPIRED' && Date.parse(r.expiresAt!) > Date.now() - 7 * DAY)
    .sort((a, b) => Date.parse(b.expiresAt!) - Date.parse(a.expiresAt!))
    .map((request) => ({ request, job: jobById(request.jobId) }))
    .filter(({ job }) => job.status !== 'CANCELLED' && BigInt(job.balanceKobo) > 0n && !job.openRequest
      && !seen.has(job.id) && !!seen.add(job.id));
  const needsReview = d.reviews.filter((r) => !r.resolvedAt);
  return {
    generatedAt: iso(Date.now()), justPaid, waiting, balancesDue, expired, needsReview,
    counts: {
      justPaid: justPaid.length, waiting: waiting.length, balancesDue: balancesDue.length,
      expired: expired.length, needsReview: needsReview.length,
    },
  };
}

import type { Deps } from '../deps';
import { koboToNairaString } from '../domain/money';
import { addDays, parseLagosDate } from '../domain/time';
import { validation } from '../errors';
import { financialsOf } from './serialize';

const HEADER = [
  'date',
  'customer',
  'phone',
  'service',
  'request_kind',
  'amount_naira',
  'source',
  'payer_name',
  'kora_reference',
  'job_total_naira',
  'job_balance_naira',
];

function csvField(v: string | null | undefined): string {
  const s = v ?? '';
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One row per payment, for the provider's accountant. */
export async function exportPaymentsCsv(deps: Deps, providerId: string, opts: { from?: string; to?: string }): Promise<string> {
  const from = opts.from ? parseLagosDate(opts.from) : null;
  const to = opts.to ? parseLagosDate(opts.to) : null;
  if (opts.from && !from) throw validation('from must be YYYY-MM-DD', 'from');
  if (opts.to && !to) throw validation('to must be YYYY-MM-DD', 'to');
  const payments = await deps.db.payment.findMany({
    where: {
      providerId,
      receivedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: addDays(to, 1) } : {}) },
    },
    include: {
      request: { select: { kind: true, koraReference: true } },
      job: {
        select: {
          service: true,
          totalKobo: true,
          plan: true,
          depositKobo: true,
          readyRule: true,
          cancelledAt: true,
          customer: { select: { name: true, phoneE164: true } },
          payments: { select: { amountKobo: true, source: true } },
        },
      },
    },
    orderBy: { receivedAt: 'asc' },
    take: 20_000,
  });
  const lines = [HEADER.join(',')];
  for (const p of payments) {
    const f = financialsOf(p.job);
    lines.push(
      [
        p.receivedAt.toISOString(),
        p.job.customer.name,
        p.job.customer.phoneE164,
        p.job.service,
        p.request?.kind ?? 'MANUAL',
        koboToNairaString(p.amountKobo),
        p.source === 'MANUAL' ? 'manual (not verified by Kora)' : 'kora_verified',
        p.payerName ?? 'unknown',
        p.request?.koraReference ?? '',
        koboToNairaString(p.job.totalKobo),
        koboToNairaString(f.balanceKobo),
      ]
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

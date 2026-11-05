/**
 * Universal search. Text/phone/amount/date narrow the candidates in SQL (trigram-indexed ILIKE);
 * filter chips and saved views depend on derived balances, so they are applied in memory over at
 * most MAX_CANDIDATES jobs. That's comfortably above what one provider accumulates in the MVP.
 */
import type { Deps } from '../deps';
import { parseSearchQuery } from '../domain/search-query';
import { addDays, lagosStartOfDay, lagosStartOfWeek, parseLagosDate } from '../domain/time';
import { validation } from '../errors';
import type { Prisma } from '../generated/prisma/client';
import { financialsOf, jobInclude, toJobSummary } from './serialize';
import type * as C from '../shared/contract';

const MAX_CANDIDATES = 1000;

const searchInclude = {
  ...jobInclude,
  reviewItems: { where: { resolvedAt: null }, select: { id: true }, take: 1 },
  _count: { select: { requests: { where: { status: 'EXPIRED' } } } },
} as const satisfies Prisma.JobInclude;

export interface SearchInput {
  q?: string;
  status?: C.SearchStatus[];
  from?: string;
  to?: string;
  view?: C.SavedView;
  limit: number;
  cursor?: string;
}

export async function search(deps: Deps, providerId: string, input: SearchInput): Promise<C.SearchResponse> {
  const parsed = parseSearchQuery(input.q);
  const now = deps.now();
  const and: Prisma.JobWhereInput[] = [{ providerId }];

  if (parsed.text) {
    and.push({
      OR: [
        { customer: { name: { contains: parsed.text, mode: 'insensitive' } } },
        { service: { contains: parsed.text, mode: 'insensitive' } },
        { notes: { contains: parsed.text, mode: 'insensitive' } },
      ],
    });
  }
  if (parsed.phoneDigits) and.push({ customer: { phoneE164: { contains: parsed.phoneDigits } } });
  if (parsed.amountKobo != null) {
    const amt = parsed.amountKobo;
    and.push({
      OR: [{ totalKobo: amt }, { depositKobo: amt }, { requests: { some: { amountKobo: amt } } }, { payments: { some: { amountKobo: amt } } }],
    });
  }

  const from = input.from ? parseLagosDate(input.from) : null;
  const toStart = input.to ? parseLagosDate(input.to) : null;
  if (input.from && !from) throw validation('from must be YYYY-MM-DD', 'from');
  if (input.to && !toStart) throw validation('to must be YYYY-MM-DD', 'to');
  if (from || toStart) {
    const range = { ...(from ? { gte: from } : {}), ...(toStart ? { lt: addDays(toStart, 1) } : {}) };
    and.push({ OR: [{ createdAt: range }, { payments: { some: { receivedAt: range } } }] });
  }
  if (input.view === 'this_week') {
    const weekStart = lagosStartOfWeek(now);
    and.push({ OR: [{ createdAt: { gte: weekStart } }, { payments: { some: { receivedAt: { gte: weekStart } } } }] });
  }

  const rows = await deps.db.job.findMany({
    where: { AND: and },
    include: searchInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_CANDIDATES,
  });

  const endToday = addDays(lagosStartOfDay(now), 1);
  const chips = new Set(input.status ?? []);
  const filtered = rows.filter((j) => {
    const f = financialsOf(j);
    const open = j.requests[0];
    const owes = !j.cancelledAt && f.balanceKobo > 0n;
    const facts: Record<C.SearchStatus, boolean> = {
      paid: f.paidKobo > 0n,
      waiting: open?.status === 'SENT',
      balance_due: owes && f.paidKobo > 0n,
      expired: owes && !open && j._count.requests > 0,
      needs_review: j.reviewItems.length > 0,
    };
    if (chips.size && ![...chips].some((c) => facts[c])) return false;
    if (input.view === 'unpaid_balances' && !owes) return false;
    if (input.view === 'needs_follow_up') {
      const dueOrOverdue = owes && j.balanceDueAt != null && j.balanceDueAt < endToday && !open;
      if (!(dueOrOverdue || facts.expired || facts.needs_review)) return false;
    }
    return true;
  });

  const offset = input.cursor ? Math.max(0, Number(input.cursor) || 0) : 0;
  const page = filtered.slice(offset, offset + input.limit);
  return {
    items: page.map((j) => toJobSummary(deps.config, j)),
    nextCursor: offset + input.limit < filtered.length ? String(offset + input.limit) : null,
    interpreted: {
      text: parsed.text,
      phone: parsed.phoneDigits,
      amountKobo: parsed.amountKobo?.toString() ?? null,
    },
  };
}

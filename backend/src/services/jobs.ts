import type { Deps } from '../deps';
import { firstRequestFor, validateJobAmounts, type PaymentPlan, type ReadyRule } from '../domain/job';
import { normalizeNigerianPhone } from '../domain/phone';
import { randomToken } from '../domain/tokens';
import { AppError, notFound, validation } from '../errors';
import type { Tx } from '../db/client';
import { jobInclude, toJobSummary, toPayment, toRequest, toReviewItem } from './serialize';
import type * as C from '../shared/contract';

export interface CreateJobInput {
  customerId?: string;
  customer?: { name: string; phone: string; messageConsent?: boolean };
  service: string;
  totalKobo: bigint;
  plan: PaymentPlan;
  depositKobo?: bigint | null;
  balanceDueAt?: Date | null;
  readyRule?: ReadyRule;
  notes?: string | null;
}

/** Find a customer by phone for this provider, or create one. Used by job creation and import. */
export async function resolveCustomer(
  tx: Tx,
  providerId: string,
  input: { customerId?: string; customer?: { name: string; phone: string; messageConsent?: boolean } },
): Promise<string> {
  if (input.customerId) {
    const c = await tx.customer.findFirst({ where: { id: input.customerId, providerId }, select: { id: true } });
    if (!c) throw notFound('Customer');
    return c.id;
  }
  if (!input.customer) throw validation('Provide customerId or customer', 'customerId');
  const phone = normalizeNigerianPhone(input.customer.phone);
  if (!phone) throw validation('Enter a valid Nigerian phone number', 'customer.phone');
  const existing = await tx.customer.findUnique({ where: { providerId_phoneE164: { providerId, phoneE164: phone } }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.customer.create({
    data: { providerId, name: input.customer.name.trim(), phoneE164: phone, messageConsent: input.customer.messageConsent ?? false },
  });
  return created.id;
}

export async function createJob(deps: Deps, providerId: string, input: CreateJobInput): Promise<C.JobDetail> {
  const amountError = validateJobAmounts({ plan: input.plan, totalKobo: input.totalKobo, depositKobo: input.depositKobo });
  if (amountError) throw validation(amountError, amountError.startsWith('deposit') ? 'depositKobo' : 'totalKobo');
  if (input.balanceDueAt && input.plan !== 'DEPOSIT_BALANCE') {
    throw validation('balanceDueAt only applies to a deposit-and-balance plan', 'balanceDueAt');
  }
  const jobId = await deps.db.$transaction(async (tx) => {
    const provider = await tx.provider.findUniqueOrThrow({ where: { id: providerId }, select: { defaultReadyRule: true } });
    const customerId = await resolveCustomer(tx, providerId, input);
    const job = await tx.job.create({
      data: {
        providerId,
        customerId,
        service: input.service.trim(),
        totalKobo: input.totalKobo,
        plan: input.plan,
        depositKobo: input.plan === 'DEPOSIT_BALANCE' ? input.depositKobo! : null,
        balanceDueAt: input.balanceDueAt ?? null,
        readyRule: input.readyRule ?? provider.defaultReadyRule,
        notes: input.notes ?? null,
      },
    });
    const first = firstRequestFor({ plan: job.plan, totalKobo: job.totalKobo, depositKobo: job.depositKobo });
    await tx.paymentRequest.create({
      data: { providerId, jobId: job.id, kind: first.kind, amountKobo: first.amountKobo, publicToken: randomToken(16) },
    });
    return job.id;
  });
  deps.log.info('job.created', { providerId, jobId });
  return getJobDetail(deps, providerId, jobId);
}

export async function getJobSummary(deps: Deps, providerId: string, jobId: string): Promise<C.JobSummary> {
  const job = await deps.db.job.findFirst({ where: { id: jobId, providerId }, include: jobInclude });
  if (!job) throw notFound('Job');
  return toJobSummary(deps.config, job);
}

export async function getJobDetail(deps: Deps, providerId: string, jobId: string): Promise<C.JobDetail> {
  const job = await deps.db.job.findFirst({ where: { id: jobId, providerId }, include: jobInclude });
  if (!job) throw notFound('Job');
  const [requests, payments, reviews] = await Promise.all([
    deps.db.paymentRequest.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } }),
    deps.db.payment.findMany({ where: { jobId }, orderBy: { receivedAt: 'desc' } }),
    deps.db.reviewItem.findMany({ where: { jobId, resolvedAt: null }, orderBy: { createdAt: 'desc' } }),
  ]);
  return {
    ...toJobSummary(deps.config, job),
    requests: requests.map((r) => toRequest(deps.config, r)),
    payments: payments.map(toPayment),
    openReviewItems: reviews.map(toReviewItem),
  };
}

export async function listJobs(
  deps: Deps,
  providerId: string,
  opts: { status?: C.JobStatus; limit: number; cursor?: string },
): Promise<C.Page<C.JobSummary>> {
  // Status is derived from payments, so a status filter is applied after loading. Fine at
  // provider scale (hundreds to low thousands of jobs); see search.ts for the same approach.
  if (opts.status) {
    const all = await deps.db.job.findMany({ where: { providerId }, include: jobInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2000 });
    const filtered = all.map((j) => toJobSummary(deps.config, j)).filter((j) => j.status === opts.status);
    const offset = opts.cursor ? Number(opts.cursor) || 0 : 0;
    const items = filtered.slice(offset, offset + opts.limit);
    return { items, nextCursor: offset + opts.limit < filtered.length ? String(offset + opts.limit) : null };
  }
  const rows = await deps.db.job.findMany({
    where: { providerId },
    include: jobInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > opts.limit;
  const items = rows.slice(0, opts.limit);
  return { items: items.map((j) => toJobSummary(deps.config, j)), nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function updateJob(
  deps: Deps,
  providerId: string,
  jobId: string,
  patch: { service?: string; notes?: string | null; balanceDueAt?: Date | null; readyRule?: ReadyRule },
): Promise<C.JobDetail> {
  const job = await deps.db.job.findFirst({ where: { id: jobId, providerId }, select: { id: true, plan: true } });
  if (!job) throw notFound('Job');
  if (patch.balanceDueAt && job.plan !== 'DEPOSIT_BALANCE') throw validation('balanceDueAt only applies to a deposit-and-balance plan', 'balanceDueAt');
  await deps.db.job.update({
    where: { id: jobId },
    data: {
      ...(patch.service !== undefined ? { service: patch.service.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.balanceDueAt !== undefined ? { balanceDueAt: patch.balanceDueAt, balancePromptedAt: null } : {}),
      ...(patch.readyRule !== undefined ? { readyRule: patch.readyRule } : {}),
    },
  });
  return getJobDetail(deps, providerId, jobId);
}

export async function cancelJob(deps: Deps, providerId: string, jobId: string): Promise<C.JobDetail> {
  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, providerId }, select: { id: true, cancelledAt: true } });
    if (!job) throw notFound('Job');
    if (job.cancelledAt) return;
    await tx.job.update({ where: { id: jobId }, data: { cancelledAt: now } });
    await tx.paymentRequest.updateMany({
      where: { jobId, status: { in: ['DRAFT', 'SCHEDULED', 'SENT'] } },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
  });
  deps.log.info('job.cancelled', { providerId, jobId });
  return getJobDetail(deps, providerId, jobId);
}

export function assertJobOpen(job: { cancelledAt: Date | null }) {
  if (job.cancelledAt) throw new AppError('INVALID_STATE', 'This job has been cancelled');
}

/**
 * Provider account management (BE-11): export everything, delete the account, sign out everywhere.
 *
 * Retention: deletion is a hard delete of the provider and everything they own (customers, jobs,
 * requests, payments, review items, sessions). Raw Kora webhook payloads are not owned by a
 * provider and are kept for reconciliation; their retention follows the policy agreed in PR-02.
 */
import type { Deps } from '../deps';
import { AppError, validation } from '../errors';
import { CONTRACT_VERSION } from '../shared/contract';
import { jobInclude, toCustomer, toJobSummary, toPayment, toProvider, toRequest, toReviewItem } from './serialize';
import type * as C from '../shared/contract';

export async function exportAccount(deps: Deps, providerId: string): Promise<C.AccountExport> {
  const db = deps.db;
  const [provider, customers, jobs, requests, payments, reviews] = await Promise.all([
    db.provider.findUniqueOrThrow({ where: { id: providerId } }),
    db.customer.findMany({ where: { providerId }, orderBy: { createdAt: 'asc' } }),
    db.job.findMany({ where: { providerId }, include: jobInclude, orderBy: { createdAt: 'asc' } }),
    db.paymentRequest.findMany({ where: { providerId }, orderBy: { createdAt: 'asc' } }),
    db.payment.findMany({ where: { providerId }, orderBy: { receivedAt: 'asc' } }),
    db.reviewItem.findMany({ where: { providerId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const group = <T extends { jobId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.jobId) m.set(r.jobId, [...(m.get(r.jobId) ?? []), r]);
    return m;
  };
  const reqByJob = group(requests);
  const payByJob = group(payments);
  const reviewByJob = group(reviews);
  deps.log.info('account.exported', { providerId, jobs: jobs.length });
  return {
    exportedAt: deps.now().toISOString(),
    contractVersion: CONTRACT_VERSION,
    provider: toProvider(provider),
    customers: customers.map(toCustomer),
    jobs: jobs.map((j) => ({
      ...toJobSummary(deps.config, j),
      requests: (reqByJob.get(j.id) ?? []).map((r) => toRequest(deps.config, r)),
      payments: (payByJob.get(j.id) ?? []).map(toPayment),
      openReviewItems: (reviewByJob.get(j.id) ?? []).filter((r) => !r.resolvedAt).map(toReviewItem),
    })),
  };
}

/**
 * Permanently delete the provider's account. The provider must type their business name to
 * confirm. Refused while a customer could still pay into a live account.
 */
export async function deleteAccount(deps: Deps, providerId: string, confirmBusinessName: string): Promise<void> {
  const provider = await deps.db.provider.findUniqueOrThrow({ where: { id: providerId }, select: { businessName: true } });
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm(confirmBusinessName) !== norm(provider.businessName)) {
    throw validation('Type your business name exactly to confirm', 'confirmBusinessName');
  }
  const live = await deps.db.paymentRequest.count({ where: { providerId, status: 'SENT', expiresAt: { gt: deps.now() } } });
  if (live) {
    throw new AppError('INVALID_STATE', `You have ${live} payment request${live === 1 ? '' : 's'} a customer can still pay. Cancel ${live === 1 ? 'it' : 'them'} or wait for expiry first.`, {
      liveRequests: live,
    });
  }
  await deps.db.provider.delete({ where: { id: providerId } });
  deps.log.info('account.deleted', { providerId });
}

/** Invalidate every session for this provider, on every device. */
export async function logoutEverywhere(deps: Deps, providerId: string): Promise<number> {
  const { count } = await deps.db.session.deleteMany({ where: { providerId } });
  deps.log.info('auth.logout_everywhere', { providerId, sessions: count });
  return count;
}

/**
 * Reconciliation (BE-06 recheck, BE-14 background): ask Kora directly about one request and record
 * any payment it confirms. Uses recordVerifiedCharge, the same code path as webhooks, so the
 * accepted amount is used and a payment can never be credited twice.
 */
import type { Deps } from '../deps';
import { recordVerifiedCharge } from './payments';

/** Keep checking a request this long after its account expired, to catch late payments. */
export const RECONCILE_GRACE_MS = 30 * 60 * 1000;
/** Minimum gap between two background checks of the same request. */
export const RECONCILE_INTERVAL_MS = 2 * 60 * 1000;

export type ReconcileOutcome = 'no_account' | 'already_paid' | 'recorded' | 'not_paid';

/** Statuses for which Kora may hold a payment: live, or closed but possibly paid late. */
const CHECKABLE = ['SENT', 'EXPIRED', 'CANCELLED'] as const;

/** Throws KoraError when Kora can't be reached (callers decide whether to retry). */
export async function reconcileRequest(deps: Deps, requestId: string): Promise<ReconcileOutcome> {
  const r = await deps.db.paymentRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, koraReference: true, accountNumber: true },
  });
  if (!r || !r.koraReference || !r.accountNumber) return 'no_account';
  if (r.status === 'PAID') return 'already_paid';
  if (!(CHECKABLE as readonly string[]).includes(r.status)) return 'no_account';

  await deps.db.paymentRequest.update({ where: { id: r.id }, data: { lastCheckedAt: deps.now() } });
  const charge = await deps.kora.queryCharge(r.koraReference);
  if (charge?.state !== 'success') return 'not_paid';
  const result = await recordVerifiedCharge(deps, charge, null);
  return result.outcome === 'recorded' ? 'recorded' : 'already_paid';
}

import type { Deps } from '../deps';
import { firstName } from '../domain/messages';
import { receiptNumber } from '../domain/tokens';
import { notFound } from '../errors';
import { financialsOf } from './serialize';
import type * as C from '../shared/contract';

/** Customer-facing view of one request. Never exposes phone numbers or internal ids. */
export async function getPublicRequest(deps: Deps, publicToken: string): Promise<C.PublicRequest> {
  const r = await deps.db.paymentRequest.findUnique({
    where: { publicToken },
    include: {
      provider: { select: { businessName: true } },
      payment: true,
      job: {
        select: {
          service: true,
          totalKobo: true,
          plan: true,
          depositKobo: true,
          readyRule: true,
          cancelledAt: true,
          customer: { select: { name: true } },
          payments: { select: { amountKobo: true, source: true } },
        },
      },
    },
  });
  if (!r) throw notFound('Payment request');
  // Treat a SENT request past its expiry as expired on the page, even before the cron sweep runs.
  const status = r.status === 'SENT' && r.expiresAt && r.expiresAt <= deps.now() ? 'EXPIRED' : r.status;
  const showAccount = status === 'SENT';
  const f = financialsOf(r.job);
  return {
    status,
    businessName: r.provider.businessName,
    customerFirstName: firstName(r.job.customer.name),
    service: r.job.service,
    kind: r.kind,
    amountKobo: r.amountKobo.toString(),
    bankName: showAccount ? r.bankName : null,
    accountNumber: showAccount ? r.accountNumber : null,
    accountName: showAccount ? r.accountName : null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
    receipt: r.payment
      ? {
          amountKobo: r.payment.amountKobo.toString(),
          paidAt: r.payment.receivedAt.toISOString(),
          reference: receiptNumber(r.payment.id),
          jobTotalKobo: r.job.totalKobo.toString(),
          jobPaidKobo: f.paidKobo.toString(),
          jobBalanceKobo: (f.balanceKobo > 0n ? f.balanceKobo : 0n).toString(),
        }
      : null,
  };
}

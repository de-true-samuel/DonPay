/**
 * Dev/demo helpers, available only when KORA_MODE=fake. They exist so the frontend and the demo can
 * run end to end before Kora enables single-use accounts. The simulated payment goes through the
 * SAME recordVerifiedCharge path as a real Kora-verified payment.
 */
import type { Deps } from '../deps';
import { AppError, invalidState, notFound } from '../errors';
import { recordVerifiedCharge } from './payments';

export async function simulatePayment(
  deps: Deps,
  providerId: string,
  requestId: string,
  input: { amountKobo?: bigint; payerName?: string | null },
): Promise<{ outcome: string; paymentId: string | null }> {
  if (deps.config.koraMode !== 'fake') throw new AppError('FORBIDDEN', 'Payment simulation is only available when KORA_MODE=fake');
  const r = await deps.db.paymentRequest.findFirst({ where: { id: requestId, providerId } });
  if (!r) throw notFound('Payment request');
  if (!r.koraReference || !['SENT', 'EXPIRED', 'CANCELLED', 'PAID'].includes(r.status)) {
    throw invalidState('Send the request before simulating a payment');
  }
  const result = await recordVerifiedCharge(
    deps,
    {
      reference: r.koraReference,
      state: 'success',
      rawStatus: 'success',
      amountAcceptedKobo: input.amountKobo ?? r.amountKobo,
      amountExpectedKobo: r.amountKobo,
      feeKobo: 0n,
      payerName: input.payerName === undefined ? 'SIMULATED PAYER' : input.payerName,
      payerBank: 'Fake Bank (sandbox)',
      payerAccountNumber: '0000001234',
      transactionReference: `SIM-${r.id}`,
      simulated: true,
    },
    null,
  );
  return { outcome: result.outcome, paymentId: result.outcome === 'recorded' ? result.paymentId : null };
}

import type { ReviewKind } from '../contract/contract';

export const REVIEW_LABEL: Record<ReviewKind, string> = {
  UNMATCHED_REFERENCE: 'Payment with no matching request',
  PAID_AFTER_EXPIRY: 'Paid after the account expired',
  JOB_OVERPAID: 'More than the job total was paid',
  AMOUNT_MISMATCH: 'Amount didn’t match',
  PAYER_NAME_DIFFERS: 'Payer name looks different',
  VERIFICATION_FAILED: 'Couldn’t verify with Kora',
};

export interface ResolutionOption { value: string; title: string; text: string }

const KEEP = { value: 'keep', text: 'The payment stands. Nothing else to do.' };
const REFUND = { value: 'refund', text: 'You’ll send the money back yourself. Paidar doesn’t move money.' };
export const OTHER: ResolutionOption = { value: 'other', title: 'Something else', text: 'Say what you did in the note.' };

/** What a provider can honestly record for each kind of review. Paidar only records the outcome. */
export const RESOLUTIONS: Record<ReviewKind, ResolutionOption[]> = {
  PAID_AFTER_EXPIRY: [{ ...KEEP, title: 'Accept the late payment' }, { ...REFUND, title: 'Refund the customer' }, OTHER],
  JOB_OVERPAID: [{ ...KEEP, title: 'Keep the extra as credit' }, { ...REFUND, title: 'Refund the extra' }, OTHER],
  AMOUNT_MISMATCH: [
    { ...KEEP, title: 'Accept what was paid' },
    { value: 'difference', title: 'Ask for the difference', text: 'You’ll ask the customer to pay the rest.' },
    { ...REFUND, title: 'Refund it' }, OTHER,
  ],
  PAYER_NAME_DIFFERS: [{ ...KEEP, title: 'I know this payer' }, { ...REFUND, title: 'Not my customer, refund' }, OTHER],
  VERIFICATION_FAILED: [{ value: 'checked', title: 'I checked with Kora', text: 'You confirmed the payment yourself.' }, OTHER],
  UNMATCHED_REFERENCE: [{ ...KEEP, title: 'I’ve dealt with it' }, OTHER],
};

/** The sentence stored on the review item: the chosen outcome, plus the provider's own note. */
export function buildResolution(title: string, note: string): string {
  const n = note.trim();
  return (n ? `${title}. ${n}` : title).slice(0, 500);
}

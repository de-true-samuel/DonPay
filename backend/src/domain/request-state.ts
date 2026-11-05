export type RequestStatus = 'DRAFT' | 'SCHEDULED' | 'SENT' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type RequestKind = 'FULL' | 'DEPOSIT' | 'BALANCE' | 'CUSTOM';

/** Statuses that count as "open" — at most one per job (enforced by a partial unique index too). */
export const OPEN_STATUSES = ['SCHEDULED', 'SENT'] as const satisfies readonly RequestStatus[];

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  DRAFT: ['SCHEDULED', 'SENT', 'CANCELLED'],
  SCHEDULED: ['SCHEDULED', 'SENT', 'CANCELLED'],
  // SENT -> PAID is the happy path. SENT -> SENT is an idempotent re-send.
  SENT: ['SENT', 'PAID', 'EXPIRED', 'CANCELLED'],
  // A verified payment always wins: money that Kora accepted after expiry or cancellation is real.
  EXPIRED: ['PAID'],
  CANCELLED: ['PAID'],
  PAID: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RequestStatus,
    readonly to: RequestStatus,
  ) {
    super(`A ${from.toLowerCase()} request can't become ${to.toLowerCase()}`);
  }
}

export type RequestAction = 'send' | 'schedule' | 'cancel' | 'resend';

export const ACTION_ALLOWED_FROM: Record<RequestAction, readonly RequestStatus[]> = {
  send: ['DRAFT', 'SCHEDULED', 'SENT'], // SENT is accepted so a retried "send" returns the same account
  schedule: ['DRAFT', 'SCHEDULED'],
  cancel: ['DRAFT', 'SCHEDULED', 'SENT'],
  resend: ['SENT', 'EXPIRED'],
};

export function isActionAllowed(action: RequestAction, status: RequestStatus): boolean {
  return ACTION_ALLOWED_FROM[action].includes(status);
}

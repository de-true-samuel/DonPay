import type { JobStatus, ReadyRule, RequestKind, RequestStatus } from '../contract/contract';

export type Tone = 'quiet' | 'wait' | 'ok' | 'bad';

/** Labels follow the contract's suggested wording. */
export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Details not created', tone: 'quiet' },
  SCHEDULED: { label: 'Scheduled', tone: 'quiet' },
  SENT: { label: 'Waiting', tone: 'wait' },
  PAID: { label: 'Paid', tone: 'ok' },
  EXPIRED: { label: 'Expired', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', tone: 'quiet' },
};

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Not started', tone: 'quiet' },
  PART_PAID: { label: 'Part-paid', tone: 'wait' },
  FULLY_PAID: { label: 'Fully paid', tone: 'ok' },
  CANCELLED: { label: 'Cancelled', tone: 'quiet' },
};

export const READY_RULE: Record<ReadyRule, { title: string; text: string }> = {
  AFTER_DEPOSIT: { title: 'After the deposit', text: 'Paidar says “Ready to start” once the deposit is verified.' },
  AFTER_FULL: { title: 'After full payment', text: 'Paidar says “Ready to start” only when everything is paid.' },
};

export const KIND_LABEL: Record<RequestKind, string> = {
  FULL: 'Full payment', DEPOSIT: 'Deposit', BALANCE: 'Balance', CUSTOM: 'Payment',
};

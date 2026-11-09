import { describe, expect, it } from 'vitest';
import type { JobDetail } from '../contract/contract';
import { buildJobTimeline } from './timeline';

const job = {
  createdAt: '2026-11-01T09:00:00Z', cancelledAt: null,
  requests: [
    { id: 'r1', kind: 'DEPOSIT', status: 'PAID', amountKobo: '2500000', sentAt: '2026-11-01T09:05:00Z', scheduledFor: null, expiresAt: '2026-11-01T10:05:00Z', createdAt: '2026-11-01T09:00:00Z' },
    { id: 'r2', kind: 'BALANCE', status: 'EXPIRED', amountKobo: '2500000', sentAt: '2026-11-05T09:00:00Z', scheduledFor: null, expiresAt: '2026-11-05T10:00:00Z', createdAt: '2026-11-05T08:59:00Z' },
  ],
  payments: [
    { id: 'p1', requestId: 'r1', source: 'KORA_VERIFIED', amountKobo: '2500000', payerName: 'TOLU A', payerDetailsSimulated: false, note: null, receivedAt: '2026-11-01T09:20:00Z' },
    { id: 'p2', requestId: null, source: 'MANUAL', amountKobo: '1000000', payerName: null, payerDetailsSimulated: false, note: 'cash at fitting', receivedAt: '2026-11-06T12:00:00Z' },
  ],
} as unknown as JobDetail;

describe('buildJobTimeline', () => {
  const t = buildJobTimeline(job);
  it('is newest first', () => {
    const times = t.map((i) => Date.parse(i.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
  it('marks payments by how they were verified', () => {
    expect(t.find((i) => i.paymentId === 'p1')?.trust).toBe('verified');
    expect(t.find((i) => i.paymentId === 'p2')?.trust).toBe('manual');
  });
  it('labels requests, expiry and hand-entered money plainly', () => {
    expect(t.map((i) => i.label)).toEqual(expect.arrayContaining([
      'Job created', 'Deposit request sent', 'Deposit received', 'Balance request expired', '₦10,000 recorded by you',
    ]));
  });
});

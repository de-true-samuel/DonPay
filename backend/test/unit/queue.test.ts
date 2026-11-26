import { describe, expect, it } from 'vitest';
import {
  availableHoursUntil,
  computeQueue,
  computeWeeklyAvailableHours,
  DEFAULT_WORKING_HOURS,
  validateWorkingHours,
  type QueueInputJob,
} from '../../src/domain/queue';

describe('working hours & capacity', () => {
  it('computes default 40h/week and validates constraints', () => {
    expect(computeWeeklyAvailableHours(DEFAULT_WORKING_HOURS)).toBe(40);
    expect(validateWorkingHours(DEFAULT_WORKING_HOURS)).toBeNull();

    const none = {
      ...DEFAULT_WORKING_HOURS,
      mon: { ...DEFAULT_WORKING_HOURS.mon, enabled: false },
      tue: { ...DEFAULT_WORKING_HOURS.tue, enabled: false },
      wed: { ...DEFAULT_WORKING_HOURS.wed, enabled: false },
      thu: { ...DEFAULT_WORKING_HOURS.thu, enabled: false },
      fri: { ...DEFAULT_WORKING_HOURS.fri, enabled: false },
    };
    expect(validateWorkingHours(none)).toMatch(/at least one/i);
  });

  it('computes available working hours until a deadline in Lagos time', () => {
    // Mon 2026-11-23 09:00 Lagos (08:00 UTC) -> Wed 2026-11-25 17:00 Lagos (16:00 UTC)
    // Mon 8h + Tue 8h + Wed 8h = 24h
    const now = new Date('2026-11-23T08:00:00Z');
    const due = new Date('2026-11-25T16:00:00Z');
    expect(availableHoursUntil(now, due, DEFAULT_WORKING_HOURS)).toBe(24);
  });
});

describe('computeQueue', () => {
  const now = new Date('2026-11-23T08:00:00Z'); // Mon 9:00 AM Lagos

  it('orders in_progress first, then ready (overdue -> at_risk -> due -> shorter est -> no deadline), and excludes waiting', () => {
    const jobs: QueueInputJob[] = [
      { id: 'wait-1', workStatus: 'awaiting_payment', dueDate: new Date('2026-11-23T16:00:00Z'), estimatedHours: 2, depositPaid: false, startedWithoutPayment: false },
      { id: 'ready-nodeadline', workStatus: 'ready', dueDate: null, estimatedHours: 2, depositPaid: false, startedWithoutPayment: false },
      { id: 'ready-long', workStatus: 'ready', dueDate: new Date('2026-11-24T16:00:00Z'), estimatedHours: 6, depositPaid: false, startedWithoutPayment: false },
      { id: 'ready-short', workStatus: 'ready', dueDate: new Date('2026-11-24T16:00:00Z'), estimatedHours: 2, depositPaid: true, startedWithoutPayment: false },
      { id: 'ready-overdue', workStatus: 'ready', dueDate: new Date('2026-11-22T16:00:00Z'), estimatedHours: 3, depositPaid: false, startedWithoutPayment: false },
      { id: 'prog-1', workStatus: 'in_progress', dueDate: new Date('2026-11-25T16:00:00Z'), estimatedHours: 4, depositPaid: false, startedWithoutPayment: false },
    ];

    const q = computeQueue(jobs, DEFAULT_WORKING_HOURS, now);
    expect(q.inProgress.map((x) => x.job.id)).toEqual(['prog-1']);
    expect(q.ready.map((x) => x.job.id)).toEqual([
      'ready-overdue',
      'ready-short',
      'ready-long',
      'ready-nodeadline',
    ]);
    expect(q.ready[0]!.isOverdue).toBe(true);
    expect(q.waitingForPayment.map((x) => x.job.id)).toEqual(['wait-1']);
    expect(q.waitingForPayment[0]!.rank).toBeNull();
  });

  it('flags jobs as at_risk when cumulative estimated hours exceed available hours before due date', () => {
    // Mon 9:00 AM -> Mon 5:00 PM = 8h available
    const jobs: QueueInputJob[] = [
      { id: 'j1', workStatus: 'ready', dueDate: new Date('2026-11-23T16:00:00Z'), estimatedHours: 5, depositPaid: false, startedWithoutPayment: false },
      { id: 'j2', workStatus: 'ready', dueDate: new Date('2026-11-23T16:00:00Z'), estimatedHours: 5, depositPaid: false, startedWithoutPayment: false },
    ];

    const q = computeQueue(jobs, DEFAULT_WORKING_HOURS, now);
    expect(q.ready.find((x) => x.job.id === 'j1')?.isAtRisk).toBe(false);
    expect(q.ready.find((x) => x.job.id === 'j2')?.isAtRisk).toBe(true);
    expect(q.ready.find((x) => x.job.id === 'j2')?.recommendedSlot?.hasConflict).toBe(true);
    expect(q.capacity.committedHours).toBe(10);
    expect(q.capacity.availableHours).toBe(40);
    expect(q.capacity.utilizationPercent).toBe(25);
    expect(q.ready[0]!.priorityScore).toBeGreaterThan(0);
    expect(q.ready[0]!.recommendedSlot?.dayLabel).toBeTruthy();
  });
});

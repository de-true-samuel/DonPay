/**
 * Deterministic rules-based Queue & Capacity Engine (Spec §9.10 / Flow §6.7).
 * Paidar suggests the order and flags capacity risks; the owner stays in control.
 */
import { addDays, formatDueDay, lagosMinuteOfDay, lagosStartOfDay, lagosStartOfWeek, parseHHMM } from './time';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DaySchedule {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export type WorkingHours = Record<DayKey, DaySchedule>;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '17:00' },
  sun: { enabled: false, start: '09:00', end: '17:00' },
};

const DOW_TO_KEY: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function lagosDayKey(dayStart: Date): DayKey {
  const dow = new Date(dayStart.getTime() + LAGOS_OFFSET_MS).getUTCDay();
  return DOW_TO_KEY[dow]!;
}

/** Validate working hours: >=1 day enabled, end > start, <= 16h/day. */
export function validateWorkingHours(wh: WorkingHours): string | null {
  let activeCount = 0;
  for (const key of Object.keys(wh) as DayKey[]) {
    const day = wh[key];
    if (!day.enabled) continue;
    activeCount++;
    const startMin = parseHHMM(day.start);
    const endMin = parseHHMM(day.end);
    if (startMin === null || endMin === null) return `Invalid time format for ${key}`;
    if (endMin <= startMin) return `End time must be after start time for ${key}`;
    if (endMin - startMin > 16 * 60) return `Maximum 16 working hours per day (${key})`;
  }
  if (activeCount === 0) return 'At least one working day must be active';
  return null;
}

/** Total configured working hours per week. */
export function computeWeeklyAvailableHours(wh: WorkingHours): number {
  let totalMinutes = 0;
  for (const key of Object.keys(wh) as DayKey[]) {
    const day = wh[key];
    if (!day.enabled) continue;
    const s = parseHHMM(day.start);
    const e = parseHHMM(day.end);
    if (s !== null && e !== null && e > s) totalMinutes += e - s;
  }
  return Math.round((totalMinutes / 60) * 10) / 10;
}

/** Working hours available between `now` and `deadline` in Africa/Lagos. */
export function availableHoursUntil(now: Date, deadline: Date, wh: WorkingHours): number {
  if (deadline.getTime() <= now.getTime()) return 0;

  const startDay = lagosStartOfDay(now);
  const endDay = lagosStartOfDay(deadline);
  const nowMin = lagosMinuteOfDay(now);
  const endMin = lagosMinuteOfDay(deadline);
  let totalMinutes = 0;

  const totalDays = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS);
  // Cap at 365 days to avoid unbounded loops for far-future dates
  const daysToScan = Math.min(totalDays, 365);

  for (let i = 0; i <= daysToScan; i++) {
    const curDay = addDays(startDay, i);
    const sched = wh[lagosDayKey(curDay)];
    if (!sched.enabled) continue;

    const s = parseHHMM(sched.start) ?? 9 * 60;
    const e = parseHHMM(sched.end) ?? 17 * 60;
    if (e <= s) continue;

    const windowStart = i === 0 ? Math.max(s, nowMin) : s;
    // If deadline is end-of-day (00:00 next day) or a date-only due date, treat 00:00 as full day if not same day
    const windowEnd = i === daysToScan ? (endMin === 0 && i > 0 ? e : Math.min(e, endMin)) : e;
    if (windowEnd > windowStart) {
      totalMinutes += windowEnd - windowStart;
    }
  }

  return Math.round((totalMinutes / 60) * 10) / 10;
}

export type QueueWorkStatus = 'awaiting_payment' | 'ready' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled';

export interface QueueInputJob {
  id: string;
  workStatus: QueueWorkStatus;
  dueDate: Date | null;
  estimatedHours: number | null;
  depositPaid: boolean;
  startedWithoutPayment: boolean;
}

export interface RankedQueueJob<T extends QueueInputJob> {
  job: T;
  rank: number | null;
  isOverdue: boolean;
  isAtRisk: boolean;
  reasonLabel: string;
}

export interface CapacitySummary {
  committedHours: number;
  availableHours: number;
  utilizationPercent: number;
  overByHours: number;
}

export interface ComputedQueue<T extends QueueInputJob> {
  capacity: CapacitySummary;
  inProgress: RankedQueueJob<T>[];
  ready: RankedQueueJob<T>[];
  waitingForPayment: RankedQueueJob<T>[];
}

function compareNullableDatesAsc(a: Date | null, b: Date | null): number {
  if (a && b) return a.getTime() - b.getTime();
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function compareNullableHoursAsc(a: number | null, b: number | null): number {
  if (a !== null && b !== null) return a - b;
  if (a !== null && b === null) return -1;
  if (a === null && b !== null) return 1;
  return 0;
}

function buildReasonLabel(
  job: QueueInputJob,
  isOverdue: boolean,
  isAtRisk: boolean,
  now: Date,
): string {
  const parts: string[] = [];
  if (isOverdue) parts.push('Overdue');
  else if (isAtRisk) parts.push('At risk');
  else if (job.dueDate) parts.push(`Due ${formatDueDay(job.dueDate, now)}`);
  else parts.push('No deadline');

  if (job.estimatedHours !== null) parts.push(`${job.estimatedHours}h est.`);
  else parts.push('Add estimate');

  return parts.join(' · ');
}

export function computeQueue<T extends QueueInputJob>(
  jobs: readonly T[],
  wh: WorkingHours,
  now: Date,
): ComputedQueue<T> {
  const active = jobs.filter((j) => j.workStatus === 'in_progress' || j.workStatus === 'ready');
  const waiting = jobs.filter((j) => j.workStatus === 'awaiting_payment');

  const isOverdueOf = (j: T) =>
    j.dueDate !== null && j.dueDate.getTime() < now.getTime() && j.workStatus !== 'completed' && j.workStatus !== 'cancelled';

  // At-risk calculation: walk active jobs with dueDate + estimatedHours in dueDate ascending order
  const riskEligible = active
    .filter((j) => j.dueDate !== null && j.estimatedHours !== null && j.estimatedHours > 0)
    .sort((a, b) => compareNullableDatesAsc(a.dueDate, b.dueDate));

  const atRiskIds = new Set<string>();
  let cumulativeHours = 0;
  for (const job of riskEligible) {
    cumulativeHours += job.estimatedHours!;
    const avail = availableHoursUntil(now, job.dueDate!, wh);
    if (cumulativeHours > avail) {
      atRiskIds.add(job.id);
    }
  }

  // Weekly capacity calculation (for the current Lagos week)
  const weekStart = lagosStartOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const availableHours = computeWeeklyAvailableHours(wh);
  const committedHours = Math.round(
    active
      .filter((j) => j.estimatedHours !== null && (j.dueDate === null || j.dueDate.getTime() <= weekEnd.getTime()))
      .reduce((sum, j) => sum + (j.estimatedHours ?? 0), 0) * 10,
  ) / 10;

  const utilizationPercent = availableHours > 0 ? Math.round((committedHours / availableHours) * 100) : 0;
  const overByHours = committedHours > availableHours ? Math.round((committedHours - availableHours) * 10) / 10 : 0;

  // Sort In-Progress: by dueDate ascending (no-deadline last)
  const inProgressSorted = active
    .filter((j) => j.workStatus === 'in_progress')
    .sort((a, b) => compareNullableDatesAsc(a.dueDate, b.dueDate));

  // Sort Ready: overdue first -> at_risk -> earliest dueDate -> shorter estimate -> no-deadline last
  const readySorted = active
    .filter((j) => j.workStatus === 'ready')
    .sort((a, b) => {
      const ovA = isOverdueOf(a) ? 1 : 0;
      const ovB = isOverdueOf(b) ? 1 : 0;
      if (ovA !== ovB) return ovB - ovA;

      const rkA = atRiskIds.has(a.id) ? 1 : 0;
      const rkB = atRiskIds.has(b.id) ? 1 : 0;
      if (rkA !== rkB) return rkB - rkA;

      const dueCmp = compareNullableDatesAsc(a.dueDate, b.dueDate);
      if (dueCmp !== 0) return dueCmp;

      return compareNullableHoursAsc(a.estimatedHours, b.estimatedHours);
    });

  let rank = 1;
  const inProgress: RankedQueueJob<T>[] = inProgressSorted.map((job) => {
    const overdue = isOverdueOf(job);
    const atRisk = atRiskIds.has(job.id);
    return {
      job,
      rank: rank++,
      isOverdue: overdue,
      isAtRisk: atRisk,
      reasonLabel: buildReasonLabel(job, overdue, atRisk, now),
    };
  });

  const ready: RankedQueueJob<T>[] = readySorted.map((job) => {
    const overdue = isOverdueOf(job);
    const atRisk = atRiskIds.has(job.id);
    return {
      job,
      rank: rank++,
      isOverdue: overdue,
      isAtRisk: atRisk,
      reasonLabel: buildReasonLabel(job, overdue, atRisk, now),
    };
  });

  const waitingForPayment: RankedQueueJob<T>[] = waiting
    .sort((a, b) => compareNullableDatesAsc(a.dueDate, b.dueDate))
    .map((job) => {
      const overdue = isOverdueOf(job);
      return {
        job,
        rank: null,
        isOverdue: overdue,
        isAtRisk: false,
        reasonLabel: buildReasonLabel(job, overdue, false, now),
      };
    });

  return {
    capacity: { committedHours, availableHours, utilizationPercent, overByHours },
    inProgress,
    ready,
    waitingForPayment,
  };
}

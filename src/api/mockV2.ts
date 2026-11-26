/**
 * Mock handlers for Paidar v2.0.0 endpoints (Waitlist, Queue, Work transitions,
 * Public ChargeAttempts, and Public Verified Receipts).
 */
import type { Provider } from '../contract/contract';
import type { JobSummaryV2, PublicReceiptV2, QueueJobItem, QueueResponse } from '../contract/v2';
import { json, fail, type DomainDb } from './mockDomain';

const WORK_STATUS_KEY = 'paidar.mock.work_status.v2';
const WORKING_HOURS_KEY = 'paidar.workingHours';

type MockWorkEntry = {
  workStatus: JobSummaryV2['workStatus'];
  startedWithoutPayment: boolean;
  scheduleApproved?: boolean;
  approvedSlotLabel?: string | null;
};

function loadWorkStatuses(): Record<string, MockWorkEntry> {
  try {
    const raw = localStorage.getItem(WORK_STATUS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWorkStatuses(map: Record<string, MockWorkEntry>) {
  try {
    localStorage.setItem(WORK_STATUS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function loadWeeklyAvailableHours(): number {
  try {
    const raw = localStorage.getItem(WORKING_HOURS_KEY);
    if (!raw) return 40;
    const days = JSON.parse(raw) as Record<string, { on: boolean; start: string; end: string }>;
    let mins = 0;
    for (const d of Object.values(days)) {
      if (!d.on) continue;
      const [sh, sm] = d.start.split(':').map(Number);
      const [eh, em] = d.end.split(':').map(Number);
      const diff = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
      if (diff > 0) mins += diff;
    }
    return mins > 0 ? Math.round((mins / 60) * 10) / 10 : 40;
  } catch {
    return 40;
  }
}

export function handleMockV2(
  method: string,
  path: string,
  body: unknown,
  provider: Provider,
  domain: DomainDb,
): Response | null {
  if (method === 'POST' && path === '/api/waitlist') {
    return json(200, { ok: true });
  }

  // POST /api/public/pay/:token/attempt
  const attemptMatch = /^\/api\/public\/pay\/([^/]+)\/attempt$/.exec(path);
  if (method === 'POST' && attemptMatch) {
    const token = attemptMatch[1]!;
    const req = domain.requests.find((r) => r.payLink.endsWith(`/${token}`));
    if (!req && token !== 'demo') return fail(404, 'NOT_FOUND', 'Payment request not found');
    return json(200, {
      id: `att_${Date.now()}`,
      requestId: req?.id ?? 'req_demo',
      status: 'account_active',
      koraReference: `KE-DEMO-${Date.now().toString().slice(-6)}`,
      bankName: req?.bankName ?? 'Wema Bank (Test)',
      accountName: req?.accountName ?? provider.businessName,
      accountNumberMasked: req?.accountNumber ?? '9012345678',
      expiresAt: req?.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      supersededAt: null,
    });
  }

  // GET /api/public/receipt/:token
  const receiptMatch = /^\/api\/public\/receipt\/([^/]+)$/.exec(path);
  if (method === 'GET' && receiptMatch) {
    const token = receiptMatch[1]!;
    if (token === 'demo') {
      const demoReceipt: PublicReceiptV2 = {
        businessName: provider.businessName,
        businessPhone: '+2348031234567',
        status: 'paid',
        jobTitle: 'Brand identity & logo package',
        jobDescription: 'Brand identity & logo package (Demo)',
        clientName: 'Ada Obi',
        payerName: 'ADA OBI',
        payerBank: 'GTBank',
        acceptedAmountKobo: '2500000',
        feeKobo: '37500',
        netKobo: '2462500',
        koraReference: 'KE-DEMO-948201',
        requestReference: 'req_demo',
        paidAt: new Date().toISOString(),
        isTestMode: true,
      };
      return json(200, demoReceipt);
    }
    const req = domain.requests.find((r) => r.payLink.endsWith(`/${token}`));
    if (!req || req.status !== 'PAID') {
      return fail(404, 'NOT_FOUND', 'Verified receipt not found');
    }
    const job = domain.jobs.find((j) => j.id === req.jobId);
    const cust = job ? domain.customers.find((c) => c.id === job.customerId) : null;
    const pay = domain.payments.find((p) => p.requestId === req.id);
    const accepted = BigInt(pay?.amountKobo ?? req.amountKobo);
    const fee = (accepted * 15n) / 1000n;
    const receipt: PublicReceiptV2 = {
      businessName: provider.businessName,
      businessPhone: '+2348031234567',
      status: 'paid',
      jobTitle: job?.service.slice(0, 60) ?? 'Service payment',
      jobDescription: job?.service ?? 'Service payment',
      clientName: cust?.name ?? 'Client',
      payerName: pay?.payerName ?? cust?.name ?? null,
      payerBank: pay?.payerBank ?? 'Guaranty Trust Bank',
      acceptedAmountKobo: accepted.toString(),
      feeKobo: fee.toString(),
      netKobo: (accepted - fee).toString(),
      koraReference: `KE-${req.id.slice(-8).toUpperCase()}`,
      requestReference: req.id,
      paidAt: req.paidAt ?? pay?.receivedAt ?? new Date().toISOString(),
      isTestMode: true,
    };
    return json(200, receipt);
  }

  // POST /api/jobs/:id/approve-schedule
  const approveMatch = /^\/api\/jobs\/([^/]+)\/approve-schedule$/.exec(path);
  if (method === 'POST' && approveMatch) {
    const jobId = approveMatch[1]!;
    const job = domain.jobs.find((j) => j.id === jobId);
    if (!job) return fail(404, 'NOT_FOUND', 'Job not found');
    const slotLabel = String((body as Record<string, unknown> | undefined)?.slotLabel ?? '').trim() || 'Approved schedule window';
    const wsMap = loadWorkStatuses();
    const prev = wsMap[job.id] ?? { workStatus: 'ready', startedWithoutPayment: false };
    wsMap[job.id] = { ...prev, scheduleApproved: true, approvedSlotLabel: slotLabel };
    saveWorkStatuses(wsMap);
    return json(200, { id: job.id, scheduleApproved: true, approvedSlotLabel: slotLabel });
  }

  // POST /api/jobs/:id/(start|complete|hold|resume|override-ready)
  const jobTransMatch = /^\/api\/jobs\/([^/]+)\/(start|complete|hold|resume|override-ready)$/.exec(path);
  if (method === 'POST' && jobTransMatch) {
    const [, jobId, action] = jobTransMatch;
    const job = domain.jobs.find((j) => j.id === jobId);
    if (!job) return fail(404, 'NOT_FOUND', 'Job not found');
    const wsMap = loadWorkStatuses();
    const prev = wsMap[job.id];
    let next: JobSummaryV2['workStatus'] = 'ready';
    let startedWithoutPayment = prev?.startedWithoutPayment ?? false;
    if (action === 'start') next = 'in_progress';
    else if (action === 'complete') next = 'completed';
    else if (action === 'hold') next = 'on_hold';
    else if (action === 'resume') next = 'ready';
    else if (action === 'override-ready') {
      const reason = String((body as Record<string, unknown> | undefined)?.reason ?? '').trim();
      if (reason.length < 5) return fail(400, 'VALIDATION_ERROR', 'Provide a reason of at least 5 characters.');
      next = 'ready';
      startedWithoutPayment = true;
    }
    wsMap[job.id] = { ...prev, workStatus: next, startedWithoutPayment };
    saveWorkStatuses(wsMap);
    return json(200, { id: job.id, workStatus: next, startedWithoutPayment });
  }

  // GET /api/queue
  if (method === 'GET' && path === '/api/queue') {
    const wsMap = loadWorkStatuses();
    const now = Date.now();
    const availableHours = loadWeeklyAvailableHours();
    const inProgress: QueueJobItem[] = [];
    const ready: QueueJobItem[] = [];
    const waitingForPayment: QueueJobItem[] = [];
    let committedHours = 0;

    for (const j of domain.jobs) {
      if (j.cancelledAt) continue;
      const cust = domain.customers.find((c) => c.id === j.customerId);
      const paidKobo = domain.payments
        .filter((p) => p.jobId === j.id && p.source === 'KORA_VERIFIED')
        .reduce((s, p) => s + BigInt(p.amountKobo), 0n);
      const total = BigInt(j.totalKobo);
      const threshold = j.readyRule === 'AFTER_DEPOSIT' && j.depositKobo ? BigInt(j.depositKobo) : total;
      const stored = wsMap[j.id];
      const defaultStatus: JobSummaryV2['workStatus'] = paidKobo >= threshold ? 'ready' : 'awaiting_payment';
      const workStatus = stored?.workStatus ?? defaultStatus;
      if (workStatus === 'completed' || workStatus === 'cancelled' || workStatus === 'on_hold') continue;

      const dueMs = j.balanceDueAt ? Date.parse(j.balanceDueAt) : null;
      const isOverdue = dueMs !== null && dueMs < now;
      const est = 4;
      if (workStatus === 'in_progress' || workStatus === 'ready') committedHours += est;

      // Priority = 0.35D + 0.25P + 0.15C + 0.15E + 0.10R (Blueprint §5.3)
      const hoursLeft = dueMs !== null ? (dueMs - now) / 3_600_000 : null;
      const dScore = hoursLeft === null ? 15 : hoursLeft <= 0 ? 100 : hoursLeft <= 24 ? 92 : hoursLeft <= 72 ? 75 : 45;
      const pScore = workStatus === 'awaiting_payment' ? (paidKobo > 0n ? 65 : 20) : stored?.startedWithoutPayment ? 45 : paidKobo >= total ? 100 : 90;
      const cScore = 50;
      const eScore = est <= 2 ? 95 : est <= 4 ? 80 : 65;
      const rScore = 100;
      const priorityScore = Math.round(0.35 * dScore + 0.25 * pScore + 0.15 * cScore + 0.15 * eScore + 0.10 * rScore);
      const isAtRisk = (committedHours > availableHours * 0.85 || isOverdue) && !!j.balanceDueAt;

      const item: QueueJobItem = {
        id: j.id,
        title: j.service.slice(0, 60),
        description: j.service,
        client: { id: cust?.id ?? '', name: cust?.name ?? 'Client', phoneE164: cust?.phone ?? null, email: null },
        workStatus,
        paymentTerms: j.plan === 'DEPOSIT_BALANCE' ? 'DEPOSIT' : 'FULL',
        depositPercent: j.plan === 'DEPOSIT_BALANCE' ? 50 : null,
        feeBearer: 'OWNER',
        totalKobo: j.totalKobo,
        verifiedPaidKobo: paidKobo.toString(),
        balanceKobo: (total - paidKobo).toString(),
        dueDate: j.balanceDueAt,
        estimatedHours: est,
        isOverdue,
        isAtRisk,
        startedWithoutPayment: stored?.startedWithoutPayment ?? false,
        depositPaid: j.plan === 'DEPOSIT_BALANCE' && paidKobo > 0n && paidKobo < total,
        isSample: false,
        createdAt: j.createdAt,
        rank: null,
        priorityScore,
        priorityBreakdown: {
          deadlineUrgency: dScore,
          paymentReadiness: pScore,
          customerPriority: cScore,
          effortSuitability: eScore,
          dependencyReadiness: rScore,
        },
        recommendedSlot:
          workStatus === 'awaiting_payment'
            ? null
            : {
                startIso: new Date(now + 3_600_000).toISOString(),
                endIso: new Date(now + (1 + est) * 3_600_000).toISOString(),
                dayLabel: isOverdue ? `Today 09:00–13:00 (conflict)` : `Next open ${est}h window`,
                hasConflict: isOverdue || committedHours > availableHours,
              },
        scheduleApproved: stored?.scheduleApproved ?? false,
        approvedSlotLabel: stored?.approvedSlotLabel ?? null,
        reasonLabel: isOverdue ? `Overdue · ${est}h est.` : `Score ${priorityScore} · ${est}h est.`,
      };

      if (workStatus === 'in_progress') inProgress.push(item);
      else if (workStatus === 'ready') ready.push(item);
      else waitingForPayment.push(item);
    }

    ready.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
    let rank = 1;
    inProgress.forEach((x) => { x.rank = rank++; });
    ready.forEach((x) => { x.rank = rank++; });

    const res: QueueResponse = {
      capacity: {
        committedHours,
        availableHours,
        utilizationPercent: Math.round((committedHours / availableHours) * 100),
        overByHours: committedHours > availableHours ? Math.round((committedHours - availableHours) * 10) / 10 : 0,
      },
      inProgress,
      ready,
      waitingForPayment,
    };
    return json(200, res);
  }

  return null;
}

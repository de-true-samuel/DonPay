import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../../api/errors';
import { devApi, jobsApi, paymentsApi, requestsApi } from '../../api/endpoints';
import type { JobSummary, PaymentRequest, RequestWithMessage } from '../../contract/contract';
import { useToast } from '../../ui/Toast';
import { useShare } from '../share/ShareProvider';

const first = (name: string) => name.trim().split(/\s+/)[0] || 'customer';

/** Every action a provider can take on a request, with refresh, share sheet and plain-language errors built in. */
export function useRequestActions() {
  const qc = useQueryClient();
  const share = useShare();
  const toast = useToast();

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['today'] }),
    qc.invalidateQueries({ queryKey: ['job'] }),
    qc.invalidateQueries({ queryKey: ['jobs'] }),
    qc.invalidateQueries({ queryKey: ['search'] }),
    qc.invalidateQueries({ queryKey: ['review'] }),
  ]);
  const onError = (e: unknown) => toast.error(describeError(e).message);
  const openShare = (r: RequestWithMessage) => {
    if (r.message) share.open({ title: `Send to ${first(r.job.customer.name)}`, message: r.message, request: r.request });
  };

  const send = useMutation({
    mutationFn: (requestId: string) => requestsApi.send(requestId),
    onSuccess: (r) => { void refresh(); openShare(r); },
    onError,
  });
  const schedule = useMutation({
    mutationFn: (v: { requestId: string; at: string }) => requestsApi.schedule(v.requestId, v.at),
    onSuccess: () => { void refresh(); toast.success('Reminder set. Paidar will remind you on Telegram.'); },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (requestId: string) => requestsApi.cancel(requestId),
    onSuccess: () => { void refresh(); toast.info('Request cancelled.'); },
    onError,
  });
  const resend = useMutation({
    mutationFn: (requestId: string) => requestsApi.resend(requestId),
    onSuccess: (r) => { void refresh(); openShare(r); },
    onError,
  });
  const shareAgain = useMutation({
    mutationFn: async (v: { request: PaymentRequest; job: JobSummary }) =>
      ({ ...v, message: await requestsApi.message(v.request.id) }),
    onSuccess: (r) => share.open({ title: `Send to ${first(r.job.customer.name)}`, message: r.message, request: r.request }),
    onError,
  });
  const balance = useMutation({
    mutationFn: (jobId: string) => jobsApi.requestBalance(jobId, true),
    onSuccess: (r) => { void refresh(); openShare(r); },
    onError,
  });
  const receipt = useMutation({
    mutationFn: async (v: { paymentId: string; customerName: string }) =>
      ({ ...v, message: await paymentsApi.receiptMessage(v.paymentId) }),
    onSuccess: (r) => share.open({ title: `Receipt for ${first(r.customerName)}`, message: r.message }),
    onError,
  });
  const simulate = useMutation({
    mutationFn: (requestId: string) => devApi.simulatePayment(requestId),
    onSuccess: () => { void refresh(); },
    onError,
  });

  const simulateWrong = useMutation({
    mutationFn: (v: { requestId: string; amountKobo: string }) => devApi.simulatePayment(v.requestId, { amountKobo: v.amountKobo }),
    onSuccess: () => { void refresh(); toast.info('A wrong amount arrived. Check “Needs review” on Today.'); },
    onError,
  });
  const expire = useMutation({
    mutationFn: (requestId: string) => devApi.expire(requestId),
    onSuccess: () => { void refresh(); },
    onError,
  });

  return { send, schedule, cancel, resend, shareAgain, balance, receipt, simulate, simulateWrong, expire };
}

export type RequestActions = ReturnType<typeof useRequestActions>;

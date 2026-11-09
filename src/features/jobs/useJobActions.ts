import { useMutation, useQueryClient } from '@tanstack/react-query';
import { jobsApi } from '../../api/endpoints';
import type { ManualPaymentBody, PatchJobBody } from '../../contract/contract';
import { useToast } from '../../ui/Toast';

/** Edit, cancel and record-by-hand actions. Dialogs read `.error` themselves so they can show field errors. */
export function useJobActions(jobId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => Promise.all(
    ['today', 'job', 'jobs', 'customer', 'customers', 'search', 'review'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
  );
  const update = useMutation({
    mutationFn: (b: PatchJobBody) => jobsApi.update(jobId, b),
    onSuccess: () => { void refresh(); toast.success('Job updated.'); },
  });
  const cancel = useMutation({
    mutationFn: () => jobsApi.cancel(jobId),
    onSuccess: () => { void refresh(); toast.info('Job cancelled.'); },
  });
  const manual = useMutation({
    mutationFn: (b: ManualPaymentBody) => jobsApi.manualPayment(jobId, b),
    onSuccess: () => { void refresh(); toast.success('Payment recorded. It’s marked “Not verified”.'); },
  });
  return { update, cancel, manual };
}

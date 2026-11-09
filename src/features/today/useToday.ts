import { useQuery } from '@tanstack/react-query';
import { todayApi } from '../../api/endpoints';

export const TODAY_KEY = ['today'] as const;

/** Polls every 15 s while something is waiting for payment, every 30 s otherwise. Pauses when the tab is hidden. */
export function useToday() {
  return useQuery({
    queryKey: TODAY_KEY,
    queryFn: todayApi.get,
    refetchInterval: (q) => (q.state.data && q.state.data.counts.waiting > 0 ? 15_000 : 30_000),
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

import type { SavedView, SearchStatus } from '../contract/contract';

const STATUSES: SearchStatus[] = ['paid', 'waiting', 'balance_due', 'expired', 'needs_review'];
const VIEWS: SavedView[] = ['unpaid_balances', 'this_week', 'needs_follow_up'];

export const parseStatuses = (s: string | null): SearchStatus[] =>
  (s ?? '').split(',').filter((x): x is SearchStatus => (STATUSES as string[]).includes(x));

export const toStatusParam = (list: SearchStatus[]): string | null => (list.length ? list.join(',') : null);

export const toggleStatus = (list: SearchStatus[], s: SearchStatus): SearchStatus[] =>
  list.includes(s) ? list.filter((x) => x !== s) : STATUSES.filter((x) => x === s || list.includes(x));

export const parseView = (s: string | null): SavedView | null => (VIEWS as string[]).includes(s ?? '') ? (s as SavedView) : null;

export const isDateParam = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function exportFilename(from: string, to: string): string {
  return `paidar-payments-${from || 'start'}-to-${to || 'today'}.csv`;
}

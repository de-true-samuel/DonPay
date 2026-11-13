import { api, apiDownload } from './client';
import {
  AuthExchangeResponse, Customer, CustomerListPage, CustomerPage, ImportResult, JobDetail, JobPage, Payment, PreparedMessage, Provider, PublicRequest, PublicStatus, RequestWithMessage, ReviewItem, ReviewPage, SearchResponse,
  SimulateResult, TelegramLinkResponse, TodayResponse,
} from '../contract/contract';
import type {
  CreateCustomerBody, CreateJobBody, ManualPaymentBody, PatchCustomerBody, PatchJobBody, PatchMeBody, ResolveBody, SearchParams,
} from '../contract/contract';

export const authApi = {
  exchange: (token: string) =>
    api('/api/auth/exchange', { method: 'POST', body: { token }, schema: AuthExchangeResponse }),
  devLogin: (businessName: string) =>
    api('/api/auth/dev-login', { method: 'POST', body: { businessName }, schema: AuthExchangeResponse }),
  logout: () => api<void>('/api/auth/logout', { method: 'POST' }),
};

export const meApi = {
  get: () => api('/api/me', { schema: Provider }),
  update: (body: PatchMeBody) => api('/api/me', { method: 'PATCH', body, schema: Provider }),
  telegramLink: () => api('/api/me/telegram-link', { method: 'POST', schema: TelegramLinkResponse }),
};

export const todayApi = {
  get: () => api('/api/today', { schema: TodayResponse }),
};

export const jobsApi = {
  list: (query: { status?: string; limit?: number; cursor?: string } = {}) =>
    api('/api/jobs', { query, schema: JobPage }),
  get: (id: string) => api(`/api/jobs/${id}`, { schema: JobDetail }),
  create: (body: CreateJobBody) => api('/api/jobs', { method: 'POST', body, schema: JobDetail }),
  update: (id: string, body: PatchJobBody) => api(`/api/jobs/${id}`, { method: 'PATCH', body, schema: JobDetail }),
  cancel: (id: string) => api(`/api/jobs/${id}/cancel`, { method: 'POST', schema: JobDetail }),
  manualPayment: (id: string, body: ManualPaymentBody) =>
    api(`/api/jobs/${id}/payments/manual`, { method: 'POST', body, schema: Payment }),
  /** The amount is always computed by the backend (total − paid). Never send one. */
  requestBalance: (id: string, send: boolean) =>
    api(`/api/jobs/${id}/requests/balance`, { method: 'POST', body: { send }, schema: RequestWithMessage }),
};

export const customersApi = {
  list: (query: { q?: string; limit?: number; cursor?: string } = {}) =>
    api('/api/customers', { query, schema: CustomerListPage }),
  get: (id: string) => api(`/api/customers/${id}`, { schema: CustomerPage }),
  create: (body: CreateCustomerBody) => api('/api/customers', { method: 'POST', body, schema: Customer }),
  update: (id: string, body: PatchCustomerBody) =>
    api(`/api/customers/${id}`, { method: 'PATCH', body, schema: Customer }),
  importCsv: (csv: string) => api('/api/customers/import', { method: 'POST', body: { csv }, schema: ImportResult }),
};

export const requestsApi = {
  send: (id: string) => api(`/api/requests/${id}/send`, { method: 'POST', schema: RequestWithMessage }),
  schedule: (id: string, scheduledFor: string) =>
    api(`/api/requests/${id}/schedule`, { method: 'POST', body: { scheduledFor }, schema: RequestWithMessage }),
  cancel: (id: string) => api(`/api/requests/${id}/cancel`, { method: 'POST', schema: RequestWithMessage }),
  resend: (id: string) => api(`/api/requests/${id}/resend`, { method: 'POST', schema: RequestWithMessage }),
  message: (id: string) => api(`/api/requests/${id}/message`, { schema: PreparedMessage }),
};

export const paymentsApi = {
  receiptMessage: (id: string) => api(`/api/payments/${id}/receipt-message`, { schema: PreparedMessage }),
};

/** Only works when the backend runs with KORA_MODE=fake. */
export const devApi = {
  simulatePayment: (requestId: string, body: { amountKobo?: string; payerName?: string | null } = {}) =>
    api(`/api/dev/simulate-payment/${requestId}`, { method: 'POST', body, schema: SimulateResult }),
  /** Mock API only: expires a sent request so you can test "Send again". */
  expire: (requestId: string) => api(`/api/dev/expire/${requestId}`, { method: 'POST' }),
};

export const searchApi = {
  search: (p: SearchParams) => api('/api/search', { query: { ...p }, schema: SearchResponse }),
};

export const reviewApi = {
  list: (query: { state?: 'open' | 'resolved'; limit?: number; cursor?: string } = {}) =>
    api('/api/review', { query, schema: ReviewPage }),
  resolve: (id: string, body: ResolveBody) =>
    api(`/api/review/${id}/resolve`, { method: 'POST', body, schema: ReviewItem }),
};

export const exportApi = {
  csv: (query: { from?: string; to?: string }) => apiDownload('/api/export.csv', query),
};

export const publicApi = {
  getRequest: (token: string) => api(`/api/public/requests/${token}`, { schema: PublicRequest }),
  getStatus: (token: string) => api(`/p/${token}/status`, { schema: PublicStatus }),
  claimPaid: (token: string) => api<{ ok: boolean }>(`/p/${token}/claim-paid`, { method: 'POST' }),
};

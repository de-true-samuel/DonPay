import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { customersApi, jobsApi, requestsApi } from '../api/endpoints';
import type { CreateJobBody, CustomerSummary, RequestWithMessage } from '../contract/contract';
import { useShare } from '../features/share/ShareProvider';
import { getPendingVerificationEmail } from '../lib/emailVerify';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira, parseNairaInput } from '../lib/money';
import { isValidNgPhone } from '../lib/quickEntry';
import { formatPhone } from '../lib/phone';
import { lagosDateToIso } from '../lib/time';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';

type Terms = 'FULL' | 'DEPOSIT' | 'PAY_ON_DELIVERY';

interface Form {
  name: string;
  phone: string;
  email: string;
  service: string;
  total: string;
  due: string;
  noDeadline: boolean;
  title: string;
  estimatedHours: string;
  terms: Terms;
  depositPct: number;
  feeBearer: 'OWNER' | 'CLIENT';
  notes: string;
}

type Errors = Partial<Record<'name' | 'phone' | 'service' | 'total' | 'due', string>>;

const MORE_OPEN_KEY = 'paidar.new_request.more_open';

function lagosDatePlus(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000 + 3_600_000);
  return d.toISOString().slice(0, 10);
}

function asField(kobo: string | null): string {
  return kobo ? formatNaira(kobo, 'auto').replace('₦', '') : '';
}

function validate(f: Form, hasCustomer: boolean): { e: Errors; total: string | null } {
  const e: Errors = {};
  if (!hasCustomer) {
    if (!f.name.trim()) e.name = 'Enter the client’s name.';
    if (!f.phone.trim()) e.phone = 'Enter a WhatsApp or phone number.';
    else if (!isValidNgPhone(f.phone)) e.phone = 'Use a valid number like 0803 123 4567.';
  }
  const desc = f.service.trim();
  if (desc.length < 3 || desc.length > 500) {
    e.service = 'Describe the job in 3–500 characters.';
  }
  const total = parseNairaInput(f.total);
  const koboVal = total ? BigInt(total) : 0n;
  if (!total || koboVal < 10_000n || koboVal > 1_000_000_000n) {
    e.total = 'Enter an amount between ₦100 and ₦10,000,000.';
  }
  if (!f.noDeadline && !f.due) {
    e.due = 'Pick a due date or select “No deadline”.';
  }
  return { e, total };
}

export function NewRequestPage() {
  useDocumentTitle('New payment request');
  const nav = useNavigate();
  const qc = useQueryClient();
  const share = useShare();
  const toast = useToast();
  const [params] = useSearchParams();
  const customerId = params.get('customerId') ?? params.get('client');

  const preset = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.get(customerId!),
    enabled: !!customerId,
  });
  const known = preset.data?.customer;

  const recentJobs = useQuery({
    queryKey: ['jobs', 'dup-check'],
    queryFn: () => jobsApi.list({ limit: 20 }),
    staleTime: 30_000,
  });

  const [moreOpen, setMoreOpen] = useState(() => {
    try { return localStorage.getItem(MORE_OPEN_KEY) === '1'; } catch { return false; }
  });

  const [form, setForm] = useState<Form>(() => ({
    name: '',
    phone: '',
    email: '',
    service: params.get('service') ?? '',
    total: asField(params.get('total')),
    due: params.get('due') ?? lagosDatePlus(3),
    noDeadline: false,
    title: '',
    estimatedHours: '',
    terms: (params.get('plan') === 'DEPOSIT_BALANCE' ? 'DEPOSIT' : 'FULL') as Terms,
    depositPct: 50,
    feeBearer: 'OWNER',
    notes: '',
  }));

  const [selectedClient, setSelectedClient] = useState<CustomerSummary | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [blurred, setBlurred] = useState<Set<string>>(() => new Set());
  const [serverErrs, setServerErrs] = useState<Errors>({});
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [dupJobId, setDupJobId] = useState<string | null>(null);

  const refs = {
    name: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    service: useRef<HTMLTextAreaElement>(null),
    total: useRef<HTMLInputElement>(null),
    due: useRef<HTMLInputElement>(null),
  };

  const dirty = !!(form.name || form.phone || form.service || form.total || form.notes);
  useUnsavedGuard(dirty);

  const customerQuery = useQuery({
    queryKey: ['customers', 'autocomplete', form.name.trim()],
    queryFn: () => customersApi.list({ q: form.name.trim(), limit: 5 }),
    enabled: !customerId && !selectedClient && form.name.trim().length >= 2,
    staleTime: 10_000,
  });
  const suggestions = customerQuery.data?.items ?? [];

  const hasCustomer = !!customerId || !!selectedClient;
  const v = validate(form, hasCustomer);

  const showErr = (k: keyof Errors) => {
    if (serverErrs[k]) return serverErrs[k];
    if (submitted || blurred.has(k)) return v.e[k];
    return undefined;
  };

  function markBlur(k: keyof Errors) {
    setBlurred((prev) => new Set(prev).add(k));
  }

  function updateField<K extends keyof Form>(k: K, val: Form[K]) {
    setForm((f) => ({ ...f, [k]: val }));
    if (k in serverErrs) setServerErrs((s) => ({ ...s, [k]: undefined }));
  }

  function toggleMore() {
    setMoreOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(MORE_OPEN_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  const totalBig = v.total ? BigInt(v.total) : 0n;
  const depositKobo =
    form.terms === 'DEPOSIT' && totalBig > 0n
      ? ((totalBig * BigInt(form.depositPct)) / 100n).toString()
      : null;
  const balanceKobo =
    depositKobo && totalBig > 0n
      ? (totalBig - BigInt(depositKobo)).toString()
      : null;

  const create = useMutation({
    mutationFn: async () => {
      const targetClientId = customerId ?? selectedClient?.id;
      const body: CreateJobBody = {
        ...(targetClientId
          ? { customerId: targetClientId }
          : { customer: { name: form.name.trim(), phone: form.phone.trim() } }),
        service: form.service.trim(),
        totalKobo: v.total!,
        plan: form.terms === 'DEPOSIT' ? 'DEPOSIT_BALANCE' : 'FULL',
        ...(form.terms === 'DEPOSIT' && depositKobo ? { depositKobo } : {}),
        balanceDueAt: form.noDeadline || !form.due ? null : lagosDateToIso(form.due),
        notes: form.notes.trim() || undefined,
      };
      const job = await jobsApi.create(body);
      let sent: RequestWithMessage | null = null;
      let sendErr: unknown = null;
      if (form.terms !== 'PAY_ON_DELIVERY' && job.openRequest) {
        try {
          sent = await requestsApi.send(job.openRequest.id);
        } catch (e) {
          sendErr = e;
        }
      }
      return { job, sent, sendErr };
    },
    onSuccess: ({ job, sent, sendErr }) => {
      void qc.invalidateQueries({ queryKey: ['today'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      nav(`/app/jobs/${job.id}`);
      if (sent?.message) {
        share.open({
          title: `Payment details for ${job.customer.name.split(' ')[0]}`,
          message: sent.message,
          request: sent.request,
        });
      } else if (sendErr) {
        toast.error(`Saved, but ${describeError(sendErr).message}.`);
      } else {
        toast.success('Job created.');
      }
    },
    onError: (e) => {
      const d = describeError(e);
      if (d.fieldErrors) {
        const next: Errors = {};
        if (d.fieldErrors['customer.name']?.[0]) next.name = d.fieldErrors['customer.name'][0];
        if (d.fieldErrors['customer.phone']?.[0]) next.phone = d.fieldErrors['customer.phone'][0];
        if (d.fieldErrors.service?.[0]) next.service = d.fieldErrors.service[0];
        if (d.fieldErrors.totalKobo?.[0]) next.total = d.fieldErrors.totalKobo[0];
        setServerErrs(next);
      } else {
        toast.error("Couldn't save. Your details are kept. Try again.");
      }
    },
  });

  function handleSubmit(bypassDup = false) {
    setSubmitted(true);
    const order: (keyof Errors)[] = ['name', 'phone', 'service', 'total', 'due'];
    const firstBad = order.find((k) => !!v.e[k]);
    if (firstBad) {
      const el = refs[firstBad]?.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
      return;
    }

    if (getPendingVerificationEmail()) {
      setVerifyModalOpen(true);
      return;
    }

    // 10-minute duplicate guard (NEW-18)
    if (!bypassDup && v.total && recentJobs.data?.items) {
      const targetName = (known?.name ?? selectedClient?.name ?? form.name).trim().toLowerCase();
      const tenMinsAgo = Date.now() - 10 * 60_000;
      const dup = recentJobs.data.items.find(
        (j) =>
          j.totalKobo === v.total &&
          j.customer.name.trim().toLowerCase() === targetName &&
          Date.parse(j.createdAt) >= tenMinsAgo,
      );
      if (dup) {
        setDupJobId(dup.id);
        return;
      }
    }

    create.mutate();
  }

  return (
    <div data-flow-id="NEW-00">
      <div className="pf-page-head">
        <div>
          <h1>New payment request</h1>
          <p className="pf-page-head__sub">Four fields to a shareable payment link.</p>
        </div>
        <Link to="/app" className="pf-btn pf-btn--secondary" data-flow-id="NEW-17">Cancel</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start' }}>
        {/* Main Form (max 720px) */}
        <form
          className="pf-card"
          style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}
          noValidate
          onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        >
          {/* 1. Client */}
          <div>
            <label htmlFor="new-client" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Client
            </label>
            {known || selectedClient ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 9, background: 'var(--bg-selected)', border: '1px solid #C9D5FF' }}>
                <div>
                  <strong>{(known ?? selectedClient)!.name}</strong>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13, marginLeft: 8 }}>
                    {formatPhone((known ?? selectedClient)!.phone)}
                  </span>
                </div>
                {!customerId && (
                  <button type="button" onClick={() => setSelectedClient(null)} style={{ border: 0, background: 'transparent', color: 'var(--action-primary)', fontWeight: 600, cursor: 'pointer' }}>
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  id="new-client"
                  ref={refs.name}
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  onBlur={() => markBlur('name')}
                  placeholder="Search or enter client name (e.g. Ada Obi)"
                  aria-describedby={showErr('name') ? 'err-name' : undefined}
                  data-flow-id="NEW-01"
                  style={{ width: '100%', height: 48, padding: '0 12px', borderRadius: 9, border: `1px solid ${showErr('name') ? 'var(--status-danger)' : 'var(--border-strong)'}` }}
                />
                {showErr('name') && <p id="err-name" style={{ color: 'var(--status-danger)', fontSize: 12.5 }}>{showErr('name')}</p>}

                {suggestions.length > 0 && (
                  <div style={{ border: '1px solid var(--border-default)', borderRadius: 9, overflow: 'hidden' }}>
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedClient(c)}
                        style={{
                          width: '100%', textAlign: 'left', padding: '10px 12px', border: 0,
                          borderBottom: '1px solid var(--border-default)', background: '#FFFFFF', cursor: 'pointer',
                          display: 'flex', justifyContent: 'space-between',
                        }}
                      >
                        <strong>{c.name}</strong>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{formatPhone(c.phone)}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }} data-flow-id="NEW-02">
                  <div>
                    <label htmlFor="new-phone" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>WhatsApp / phone</label>
                    <input
                      id="new-phone"
                      ref={refs.phone}
                      type="tel"
                      value={form.phone}
                      onChange={(e) => updateField('phone', e.target.value)}
                      onBlur={() => markBlur('phone')}
                      placeholder="0803 123 4567"
                      style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 9, border: `1px solid ${showErr('phone') ? 'var(--status-danger)' : 'var(--border-strong)'}` }}
                    />
                    {showErr('phone') && <p style={{ color: 'var(--status-danger)', fontSize: 12.5, marginTop: 4 }}>{showErr('phone')}</p>}
                  </div>
                  <div>
                    <label htmlFor="new-email" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Client email (optional)</label>
                    <input
                      id="new-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      placeholder="ada@example.com"
                      style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. Description */}
          <div>
            <label htmlFor="new-service" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              What’s the job?
            </label>
            <textarea
              id="new-service"
              ref={refs.service}
              rows={3}
              maxLength={500}
              value={form.service}
              onChange={(e) => updateField('service', e.target.value)}
              onBlur={() => markBlur('service')}
              placeholder="e.g. Brand identity package with logo, colours, and social kit"
              data-flow-id="NEW-03"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 9,
                border: `1px solid ${showErr('service') ? 'var(--status-danger)' : 'var(--border-strong)'}`,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--status-danger)', fontSize: 12.5 }}>{showErr('service') ?? ''}</span>
              {form.service.length >= 400 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{form.service.length}/500</span>
              )}
            </div>
          </div>

          {/* 3. Amount */}
          <div>
            <label htmlFor="new-total" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Amount
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontWeight: 600, color: 'var(--text-secondary)' }}>₦</span>
              <input
                id="new-total"
                ref={refs.total}
                type="text"
                inputMode="decimal"
                value={form.total}
                onChange={(e) => updateField('total', e.target.value)}
                onBlur={() => markBlur('total')}
                placeholder="25,000"
                data-flow-id="NEW-04"
                style={{
                  width: '100%', height: 48, padding: '0 12px 0 32px', borderRadius: 9,
                  border: `1px solid ${showErr('total') ? 'var(--status-danger)' : 'var(--border-strong)'}`,
                  fontSize: 16, fontWeight: 600,
                }}
              />
            </div>
            {showErr('total') && <p style={{ color: 'var(--status-danger)', fontSize: 12.5, marginTop: 4 }}>{showErr('total')}</p>}
          </div>

          {/* 4. Due Date + Quick Chips + No deadline */}
          <div>
            <label htmlFor="new-due" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Due date
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }} data-flow-id="NEW-05">
              {[
                { label: 'Today', days: 0 },
                { label: 'Tomorrow', days: 1 },
                { label: 'In 3 days', days: 3 },
                { label: 'Next week', days: 7 },
              ].map((chip) => {
                const target = lagosDatePlus(chip.days);
                const active = !form.noDeadline && form.due === target;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => { updateField('noDeadline', false); updateField('due', target); }}
                    style={{
                      padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      border: `1px solid ${active ? 'var(--action-primary)' : 'var(--border-default)'}`,
                      background: active ? 'var(--bg-selected)' : '#FFFFFF',
                      color: active ? 'var(--action-primary)' : 'var(--text-primary)',
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <input
                id="new-due"
                ref={refs.due}
                type="date"
                disabled={form.noDeadline}
                min={lagosDatePlus(0)}
                value={form.noDeadline ? '' : form.due}
                onChange={(e) => updateField('due', e.target.value)}
                onBlur={() => markBlur('due')}
                style={{
                  height: 44, padding: '0 12px', borderRadius: 9,
                  border: `1px solid ${showErr('due') ? 'var(--status-danger)' : 'var(--border-strong)'}`,
                }}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }} data-flow-id="NEW-06">
                <input type="checkbox" checked={form.noDeadline} onChange={(e) => updateField('noDeadline', e.target.checked)} />
                <span>No deadline</span>
              </label>
            </div>
            {showErr('due') && <p style={{ color: 'var(--status-danger)', fontSize: 12.5, marginTop: 4 }}>{showErr('due')}</p>}
          </div>

          {/* Collapsed "More details" Disclosure (NEW-07 to NEW-13) */}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14 }}>
            <button
              type="button"
              onClick={toggleMore}
              aria-expanded={moreOpen}
              data-flow-id="NEW-07"
              style={{
                border: 0, background: 'transparent', padding: 0, color: 'var(--action-primary)',
                fontWeight: 600, fontSize: 13.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Icon name="chevron" size={16} />
              <span>{moreOpen ? 'Hide extra details' : 'More details (hours, deposit terms, notes)'}</span>
            </button>

            {moreOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div>
                    <label htmlFor="new-title" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Title (optional)</label>
                    <input
                      id="new-title"
                      type="text"
                      maxLength={80}
                      value={form.title}
                      onChange={(e) => updateField('title', e.target.value)}
                      placeholder="Defaults to first 60 chars"
                      data-flow-id="NEW-08"
                      style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-hours" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Estimated hours</label>
                    <input
                      id="new-hours"
                      type="number"
                      min={0.5}
                      max={200}
                      step={0.5}
                      value={form.estimatedHours}
                      onChange={(e) => updateField('estimatedHours', e.target.value)}
                      placeholder="e.g. 4"
                      data-flow-id="NEW-09"
                      style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                    />
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Optional, powers queue risk warnings.</span>
                  </div>
                </div>

                <div data-flow-id="NEW-10">
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Payment terms</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { v: 'FULL' as const, l: 'Pay in full first' },
                      { v: 'DEPOSIT' as const, l: 'Deposit' },
                      { v: 'PAY_ON_DELIVERY' as const, l: 'Pay on delivery' },
                    ].map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => updateField('terms', opt.v)}
                        style={{
                          padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          border: `1px solid ${form.terms === opt.v ? 'var(--action-primary)' : 'var(--border-default)'}`,
                          background: form.terms === opt.v ? 'var(--bg-selected)' : '#FFFFFF',
                          color: form.terms === opt.v ? 'var(--action-primary)' : 'var(--text-primary)',
                        }}
                      >
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>

                {form.terms === 'DEPOSIT' && (
                  <div data-flow-id="NEW-11">
                    <label htmlFor="new-dep-pct" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Deposit percentage: <strong>{form.depositPct}%</strong>
                    </label>
                    <input
                      id="new-dep-pct"
                      type="range"
                      min={10}
                      max={90}
                      step={5}
                      value={form.depositPct}
                      onChange={(e) => updateField('depositPct', Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}

                <div data-flow-id="NEW-12">
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Who pays the processing fee?</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      { v: 'OWNER' as const, l: 'I do' },
                      { v: 'CLIENT' as const, l: 'My client does' },
                    ].map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => updateField('feeBearer', opt.v)}
                        style={{
                          padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          border: `1px solid ${form.feeBearer === opt.v ? 'var(--action-primary)' : 'var(--border-default)'}`,
                          background: form.feeBearer === opt.v ? 'var(--bg-selected)' : '#FFFFFF',
                          color: form.feeBearer === opt.v ? 'var(--action-primary)' : 'var(--text-primary)',
                        }}
                      >
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="new-notes" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    Private notes (never visible to the client)
                  </label>
                  <textarea
                    id="new-notes"
                    rows={2}
                    maxLength={1000}
                    value={form.notes}
                    onChange={(e) => updateField('notes', e.target.value)}
                    data-flow-id="NEW-13"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 9, border: '1px solid var(--border-strong)' }}
                  />
                </div>
              </div>
            )}
          </div>

          <button type="submit" disabled={create.isPending} className="pf-btn pf-btn--primary" style={{ height: 48 }} data-flow-id="NEW-15">
            {create.isPending ? 'Creating link…' : form.terms === 'PAY_ON_DELIVERY' ? 'Create job' : 'Create & get link'}
          </button>
        </form>

        {/* Live Summary Card (NEW-14) */}
        <aside className="pf-card" style={{ position: 'sticky', top: 88, maxWidth: 380 }} data-flow-id="NEW-14">
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
            Live summary
          </div>
          {totalBig > 0n ? (
            form.terms === 'DEPOSIT' && depositKobo && balanceKobo ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{formatNaira(depositKobo)} now</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginBottom: 10 }}>
                  {formatNaira(depositKobo)} deposit now · {formatNaira(balanceKobo)} balance on delivery
                </p>
              </>
            ) : form.terms === 'PAY_ON_DELIVERY' ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Pay on delivery</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginBottom: 10 }}>
                  Job starts Ready immediately. Request {formatNaira(v.total!)} when delivered.
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Your client pays {formatNaira(v.total!)}</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginBottom: 10 }}>
                  Job enters your Ready queue once payment is verified.
                </p>
              </>
            )
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginBottom: 10 }}>
              Enter an amount to preview what your client pays.
            </p>
          )}
          <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 10, fontSize: 12.5, color: 'var(--text-muted)' }}>
            {form.feeBearer === 'CLIENT'
              ? 'Processing fee shown on the payment page.'
              : 'You cover the Kora processing fee.'}
          </div>
        </aside>
      </div>

      {/* Email Verification Gate Modal */}
      {verifyModalOpen && (
        <div className="pf-sheet-backdrop" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setVerifyModalOpen(false)}>
          <div role="dialog" aria-modal="true" className="pf-card" style={{ maxWidth: 420, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 8 }}>Verify your email to create payment links</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Your typed job details are kept safe. Open the link we sent to your inbox to unlock link creation.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="pf-btn pf-btn--secondary" onClick={() => setVerifyModalOpen(false)}>Close</button>
              <Link to="/verify-email" className="pf-btn pf-btn--primary">Verify email</Link>
            </div>
          </div>
        </div>
      )}

      {/* 10-minute Duplicate Guard Dialog (NEW-18) */}
      {dupJobId && (
        <div className="pf-sheet-backdrop" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setDupJobId(null)}>
          <div role="dialog" aria-modal="true" className="pf-card" style={{ maxWidth: 420, width: '100%' }} onClick={(e) => e.stopPropagation()} data-flow-id="NEW-18">
            <h2 style={{ marginBottom: 8 }}>Similar request made recently</h2>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 16 }}>
              You created a request for this client and amount within the last 10 minutes.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Link to={`/app/jobs/${dupJobId}`} className="pf-btn pf-btn--secondary">View it</Link>
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => { setDupJobId(null); handleSubmit(true); }}>
                Create anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

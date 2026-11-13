import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { customersApi, jobsApi, requestsApi } from '../api/endpoints';
import type { CreateJobBody, CustomerSummary, RequestWithMessage } from '../contract/contract';
import { useShare } from '../features/share/ShareProvider';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira, parseNairaInput } from '../lib/money';
import { isValidNgPhone } from '../lib/quickEntry';
import { formatPhone } from '../lib/phone';
import { lagosDateToIso } from '../lib/time';
import { Banner, Segmented, TextField } from '../ui/primitives';
import { useToast } from '../ui/Toast';

type Plan = 'FULL' | 'DEPOSIT_BALANCE';
interface Form {
  name: string;
  phone: string;
  service: string;
  total: string;
  plan: Plan;
  deposit: string;
  due: string;
}
type Errors = Partial<Record<keyof Form, string>>;

const asField = (kobo: string | null) => (kobo ? formatNaira(kobo, 'auto').replace('₦', '') : '');

function validate(
  f: Form,
  hasCustomer: boolean
): { e: Errors; total: string | null; deposit: string | null } {
  const e: Errors = {};
  if (!hasCustomer) {
    if (!f.name.trim()) e.name = 'Enter the customer’s name';
    if (!f.phone.trim()) e.phone = 'Enter a phone number';
    else if (!isValidNgPhone(f.phone)) e.phone = 'Use a Nigerian number like 0803 123 4567';
  }
  if (!f.service.trim()) e.service = 'Describe the service or item';
  else if (f.service.trim().length > 120) e.service = 'Keep it under 120 characters';
  const total = parseNairaInput(f.total);
  if (!total || BigInt(total) <= 0n) e.total = 'Enter an amount like 50,000 or 50k';
  const deposit = f.plan === 'DEPOSIT_BALANCE' ? parseNairaInput(f.deposit) : null;
  if (f.plan === 'DEPOSIT_BALANCE') {
    if (!deposit || BigInt(deposit) <= 0n) e.deposit = 'Enter the deposit amount';
    else if (total && BigInt(deposit) >= BigInt(total))
      e.deposit = 'The deposit must be less than the total price';
  }
  return { e, total, deposit };
}

const SERVER_KEYS: Record<string, keyof Form> = {
  'customer.name': 'name',
  'customer.phone': 'phone',
  customer: 'name',
  service: 'service',
  totalKobo: 'total',
  depositKobo: 'deposit',
  balanceDueAt: 'due',
};

export function NewRequestPage() {
  useDocumentTitle('New payment request');
  const nav = useNavigate();
  const qc = useQueryClient();
  const share = useShare();
  const toast = useToast();
  const [params] = useSearchParams();
  const customerId = params.get('customerId');
  const preset = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.get(customerId!),
    enabled: !!customerId,
  });
  const known = preset.data?.customer;

  const [form, setForm] = useState<Form>(() => ({
    name: '',
    phone: '',
    service: params.get('service') ?? '',
    total: asField(params.get('total')),
    plan: (params.get('plan') as Plan) === 'DEPOSIT_BALANCE' ? 'DEPOSIT_BALANCE' : 'FULL',
    deposit: asField(params.get('deposit')),
    due: params.get('due') ?? '',
  }));
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<Errors>({});
  const touched = useRef(new Set<keyof Form>());

  // Customer Autocomplete for existing clients
  const customerQuery = useQuery({
    queryKey: ['customers', 'autocomplete', form.name.trim()],
    queryFn: () => customersApi.list({ q: form.name.trim(), limit: 4 }),
    enabled: !customerId && form.name.trim().length >= 2,
    staleTime: 10_000,
  });
  const customerSuggestions = customerQuery.data?.items ?? [];

  function selectCustomer(c: CustomerSummary) {
    edit('name', c.name);
    edit('phone', c.phone);
  }

  function edit<K extends keyof Form>(k: K, v: Form[K]) {
    touched.current.add(k);
    setForm((f) => ({ ...f, [k]: v }));
    setServer((s) => ({ ...s, [k]: undefined }));
  }

  const v = validate(form, !!customerId);
  const err = (k: keyof Form) => server[k] ?? (submitted ? v.e[k] : undefined);

  const firstName = useMemo(() => {
    const raw = (known?.name ?? form.name).trim();
    return raw ? raw.split(' ')[0] : 'your client';
  }, [known?.name, form.name]);

  // Balance calculation for preview
  const remainingBalanceKobo = useMemo(() => {
    if (form.plan !== 'DEPOSIT_BALANCE' || !v.total || !v.deposit) return null;
    const diff = BigInt(v.total) - BigInt(v.deposit);
    return diff > 0n ? diff.toString() : '0';
  }, [form.plan, v.total, v.deposit]);

  const create = useMutation({
    mutationFn: async (sendNow: boolean) => {
      const body: CreateJobBody = {
        ...(customerId
          ? { customerId }
          : { customer: { name: form.name.trim(), phone: form.phone.trim() } }),
        service: form.service.trim(),
        totalKobo: v.total!,
        plan: form.plan,
        ...(form.plan === 'DEPOSIT_BALANCE'
          ? {
              depositKobo: v.deposit!,
              balanceDueAt: form.due ? lagosDateToIso(form.due) : null,
            }
          : {}),
      };
      const job = await jobsApi.create(body);
      let sent: RequestWithMessage | null = null;
      let sendErr: unknown = null;
      if (sendNow && job.openRequest) {
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
      nav(`/jobs/${job.id}`);
      if (sent?.message)
        share.open({
          title: `Payment details for ${job.customer.name.split(' ')[0]}`,
          message: sent.message,
          request: sent.request,
        });
      else if (sendErr)
        toast.error(
          `Job saved, but ${describeError(sendErr).message}. Tap “Get payment details” to retry.`
        );
    },
    onError: (e) => {
      const d = describeError(e);
      if (d.fieldErrors) {
        const s: Errors = {};
        for (const [k, msgs] of Object.entries(d.fieldErrors)) {
          const f = SERVER_KEYS[k];
          if (f && msgs[0]) s[f] = msgs[0];
        }
        setServer(s);
      } else toast.error(d.message);
    },
  });

  function go(sendNow: boolean) {
    setSubmitted(true);
    if (customerId && !known) return;
    if (Object.keys(v.e).length) return;
    create.mutate(sendNow);
  }

  const dep = form.plan === 'DEPOSIT_BALANCE';

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', paddingBottom: 'calc(var(--tabbar-h) + 40px)' }}>
      {/* Page Header */}
      <header className="pd-pagehead">
        <h1>New payment request</h1>
        <p className="pd-sub">
          Generate a secure, single-use payment account for your customer.
        </p>
      </header>

      {/* Main Payment Form */}
      <form
        className="pd-stack pd-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          go(true);
        }}
        style={{
          background: 'var(--paper)',
          padding: '26px 24px 28px',
          borderRadius: 'var(--r-ticket)',
          boxShadow: '0 12px 32px rgba(16, 21, 77, 0.28)',
          color: 'var(--paper-ink)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 19,
              color: 'var(--paper-ink)',
              margin: 0,
            }}
          >
            Job & Payment Details
          </h2>
          <span style={{ fontSize: 12, color: 'var(--paper-muted)', fontWeight: 600 }}>
            Exact-amount collection
          </span>
        </div>

        {customerId ? (
          preset.isError ? (
            <Banner
              tone="bad"
              action={
                <Link className="pd-btn pd-btn--line" to="/new">
                  <span>Start fresh</span>
                </Link>
              }
            >
              {describeError(preset.error).message}
            </Banner>
          ) : (
            <div className="pd-presetcustomer" style={{ marginBottom: 14 }}>
              <p style={{ margin: 0, color: 'var(--paper-ink)' }}>
                {known ? (
                  <>
                    For <strong>{known.name}</strong> · {formatPhone(known.phone)}
                  </>
                ) : (
                  'Loading customer details…'
                )}
              </p>
              <Link to="/new" style={{ color: 'var(--ground)', fontWeight: 700, fontSize: 13 }}>
                Someone else
              </Link>
            </div>
          )
        ) : (
          <>
            <TextField
              label="Customer name"
              value={form.name}
              onChange={(e) => edit('name', e.target.value)}
              placeholder="e.g. Fatima Bello"
              error={err('name')}
              autoComplete="off"
            />

            {/* Customer Autocomplete Suggestions */}
            {customerSuggestions.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  marginTop: -6,
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--paper-muted)', fontWeight: 600 }}>
                  Saved client suggestions:
                </span>
                {customerSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCustomer(c)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(20, 24, 63, 0.05)',
                      border: '1px solid rgba(20, 24, 63, 0.12)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-ui)',
                      color: 'var(--paper-ink)',
                    }}
                  >
                    <strong>{c.name}</strong>
                    <span style={{ fontSize: 13, color: 'var(--paper-muted)' }}>
                      {formatPhone(c.phone)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <TextField
              label="Phone number"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => edit('phone', e.target.value)}
              placeholder="e.g. 0803 123 4567"
              error={err('phone')}
              hint="Client’s Nigerian phone for ledger & receipt delivery"
              autoComplete="off"
            />
          </>
        )}

        <TextField
          label="Service or item description"
          value={form.service}
          onChange={(e) => edit('service', e.target.value)}
          placeholder="e.g. Bridal makeup, Custom bespoke robe, Catering"
          error={err('service')}
          maxLength={120}
        />

        <div style={{ marginTop: 4 }}>
          <Segmented<Plan>
            legend="How will they pay?"
            value={form.plan}
            onChange={(p) => edit('plan', p)}
            options={[
              { value: 'FULL', label: 'In full (100%)' },
              { value: 'DEPOSIT_BALANCE', label: 'Deposit + balance' },
            ]}
          />
        </div>

        <TextField
          label={dep ? 'Total price (₦)' : 'Amount to collect (₦)'}
          inputMode="decimal"
          value={form.total}
          onChange={(e) => edit('total', e.target.value)}
          placeholder="e.g. 50,000 or 50k"
          error={err('total')}
          hint={
            v.total
              ? `Client will pay ${formatNaira(v.total)}`
              : 'Enter figures like 50000, 50,000 or 50k'
          }
        />

        {dep && (
          <>
            <TextField
              label="Deposit amount (₦)"
              inputMode="decimal"
              value={form.deposit}
              onChange={(e) => edit('deposit', e.target.value)}
              placeholder="e.g. 20,000"
              error={err('deposit')}
              hint={
                v.deposit
                  ? `Deposit: ${formatNaira(v.deposit)} · Remaining balance: ${v.total ? formatNaira((BigInt(v.total) - BigInt(v.deposit)).toString()) : '…'}`
                  : 'Enter the initial deposit to collect now'
              }
            />
            <TextField
              label="Balance due date (optional)"
              type="date"
              value={form.due}
              onChange={(e) => edit('due', e.target.value)}
              error={err('due')}
              hint="Tracked on your Today screen when due"
            />
          </>
        )}

        {create.isError && !Object.keys(server).length && (
          <Banner tone="bad">{describeError(create.error).message}</Banner>
        )}

        {/* Primary Action Button */}
        <div style={{ marginTop: 14 }}>
          <button
            type="submit"
            className="pd-btn-primary pd-btn--block"
            disabled={create.isPending}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {create.isPending ? 'Generating account…' : 'Create and get payment details'}
          </button>
          <p
            style={{
              fontSize: 13,
              color: 'var(--paper-muted)',
              lineHeight: 1.45,
              textAlign: 'center',
              marginTop: 10,
              marginBottom: 0,
            }}
          >
            Starts the account’s 60-minute countdown. Have your chat with {firstName} open to paste details.
          </p>
        </div>

        {/* Secondary Action */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          <button
            type="button"
            className="pd-btn pd-btn--quiet"
            onClick={() => go(false)}
          >
            Save as draft without generating account
          </button>
        </div>
      </form>

      {/* Live Ticket Preview (PLACED UNDER THE FORM, UX-POLISHED) */}
      <div style={{ marginTop: 28, marginBottom: 44 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            padding: '0 4px',
          }}
        >
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 16,
              color: 'var(--ink-on-ground)',
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            Live Ticket Preview
          </h3>
          <span style={{ fontSize: 13, color: 'var(--muted-on-ground)' }}>
            Updates in real-time
          </span>
        </div>

        <article
          className="pd-ticket pd-ticket--draft"
          style={{
            background: 'var(--paper)',
            borderRadius: 'var(--r-ticket)',
            color: 'var(--paper-ink)',
            boxShadow: '0 16px 28px rgba(16, 21, 77, 0.35)',
            border: '2px dashed rgba(20, 24, 63, 0.18)',
            overflow: 'hidden',
          }}
        >
          {/* Top section: Identity */}
          <div style={{ padding: '20px 22px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <h4
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: 20,
                    margin: 0,
                    color: 'var(--paper-ink)',
                  }}
                >
                  {form.name.trim() || 'Customer Name'}
                </h4>
                <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--paper-muted)' }}>
                  {form.service.trim() || 'Service or item description'}
                </p>
              </div>
              <span
                className="pd-tag"
                style={{
                  background: 'rgba(35, 48, 166, 0.08)',
                  color: 'var(--ground)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                One-time ticket
              </span>
            </div>
          </div>

          {/* Notches + Cut line */}
          <div className="pd-ticket__cut" aria-hidden="true">
            <i />
            <i />
          </div>

          {/* Stub Preview */}
          <div style={{ padding: '16px 22px 20px', background: 'rgba(20, 24, 63, 0.02)' }}>
            {!dep ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--paper-muted)', fontWeight: 600, display: 'block' }}>
                    Pay in full
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800,
                      fontSize: 26,
                      color: 'var(--paper-ink)',
                      marginTop: 2,
                    }}
                  >
                    {v.total ? formatNaira(v.total) : '₦0.00'}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    background: 'var(--tag-warn-bg)',
                    color: 'var(--tag-warn-ink)',
                    padding: '4px 10px',
                    borderRadius: 999,
                  }}
                >
                  Dynamic Kora account · 60m expiry
                </span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Deposit Stub */}
                <div
                  style={{
                    background: 'var(--tag-copied-bg)',
                    borderRadius: 14,
                    padding: '12px 14px',
                    border: '1.5px solid var(--calm)',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--calm)' }}>
                    Deposit · Collect now
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800,
                      fontSize: 20,
                      margin: '4px 0 0',
                      color: 'var(--paper-ink)',
                    }}
                  >
                    {v.deposit ? formatNaira(v.deposit) : '₦0.00'}
                  </div>
                </div>

                {/* Balance Stub */}
                <div
                  style={{
                    background: 'rgba(20, 24, 63, 0.04)',
                    borderRadius: 14,
                    padding: '12px 14px',
                    border: '1.5px dashed var(--line-strong)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--paper-muted)', fontWeight: 600 }}>
                    Remaining balance
                  </span>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: 18,
                      margin: '4px 0 0',
                      color: 'var(--paper-muted)',
                    }}
                  >
                    {remainingBalanceKobo ? formatNaira(remainingBalanceKobo) : '₦0.00'}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--paper-muted)', display: 'block', marginTop: 2 }}>
                    {form.due ? `Due ${form.due}` : 'Account issued when requested'}
                  </span>
                </div>
              </div>
            )}

            {/* Honest Product Reassurance */}
            <div
              style={{
                marginTop: 14,
                paddingTop: 10,
                borderTop: '1px dashed rgba(20, 24, 63, 0.12)',
                fontSize: 12.5,
                color: 'var(--paper-muted)',
                lineHeight: 1.4,
              }}
            >
              🔒 <strong>Single-use Kora account:</strong> Allocated specifically for this agreement. Paidar never contacts your client; you copy and paste the details into your chat.
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

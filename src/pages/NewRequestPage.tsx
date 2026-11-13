import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { customersApi, jobsApi, requestsApi } from '../api/endpoints';
import type { CreateJobBody, CustomerSummary, RequestWithMessage } from '../contract/contract';
import { useShare } from '../features/share/ShareProvider';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira, parseNairaInput } from '../lib/money';
import { isValidNgPhone, parseQuickEntry } from '../lib/quickEntry';
import type { QuickEntry } from '../lib/quickEntry';
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
  if (!f.service.trim()) e.service = 'Describe the service';
  else if (f.service.trim().length > 120) e.service = 'Keep it under 120 characters';
  const total = parseNairaInput(f.total);
  if (!total || BigInt(total) <= 0n) e.total = 'Enter an amount like 50,000 or 50k';
  const deposit = f.plan === 'DEPOSIT_BALANCE' ? parseNairaInput(f.deposit) : null;
  if (f.plan === 'DEPOSIT_BALANCE') {
    if (!deposit || BigInt(deposit) <= 0n) e.deposit = 'Enter the deposit';
    else if (total && BigInt(deposit) >= BigInt(total))
      e.deposit = 'The deposit must be less than the total';
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
  useDocumentTitle('New request');
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

  const [text, setText] = useState('');
  const [form, setForm] = useState<Form>(() => ({
    name: '',
    phone: '',
    service: params.get('service') ?? '',
    total: asField(params.get('total')),
    plan: (params.get('plan') as Plan) === 'DEPOSIT_BALANCE' ? 'DEPOSIT_BALANCE' : 'FULL',
    deposit: asField(params.get('deposit')),
    due: params.get('due') ?? '',
  }));
  const [assumed, setAssumed] = useState<QuickEntry['assumed']>([]);
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<Errors>({});
  const touched = useRef(new Set<keyof Form>());

  // Customer Autocomplete (FE-10 & Spec Section 5.4)
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

  function onText(value: string) {
    setText(value);
    const p = parseQuickEntry(value);
    setAssumed(p.assumed);
    setForm((f) => {
      const n = { ...f };
      const set = <K extends keyof Form>(k: K, v: Form[K]) => {
        if (!touched.current.has(k)) n[k] = v;
      };
      set('name', p.name);
      set('phone', p.phone);
      set('service', p.service);
      set('total', asField(p.totalKobo));
      set('plan', p.plan);
      set('deposit', asField(p.depositKobo));
      set('due', p.balanceDueDate ?? '');
      return n;
    });
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
    return raw ? raw.split(' ')[0] : 'customer';
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
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <header className="pd-pagehead">
        <h1>New request</h1>
        <p className="pd-sub">Type it the way you’d say it in chat.</p>
      </header>

      {/* Quick Entry (Spec Section 5.4) */}
      <div className="pd-field" style={{ marginBottom: 20 }}>
        <label className="pd-label" htmlFor="pd-quick">
          Paste what the customer said
        </label>
        <textarea
          id="pd-quick"
          className="pd-input pd-input--area"
          rows={3}
          value={text}
          autoFocus={
            !customerId &&
            typeof window !== 'undefined' &&
            !('ontouchstart' in window)
          }
          onChange={(e) => onText(e.target.value)}
          placeholder="e.g. Fatima 0812 345 6789 bridal robe 45k, 20k deposit, balance friday"
        />
        <p className="pd-hint">
          Paidar never messages your customer. You paste the details.
        </p>

        {/* Parsed Chips beneath */}
        {text.trim().length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {form.name && (
              <span className="pd-copy-chip" style={{ minHeight: 32, padding: '4px 10px', fontSize: 13 }}>
                👤 {form.name}
              </span>
            )}
            {form.phone && (
              <span className="pd-copy-chip" style={{ minHeight: 32, padding: '4px 10px', fontSize: 13 }}>
                📞 {form.phone}
              </span>
            )}
            {form.service && (
              <span className="pd-copy-chip" style={{ minHeight: 32, padding: '4px 10px', fontSize: 13 }}>
                ✂ {form.service}
              </span>
            )}
            {v.total && (
              <span className="pd-copy-chip" style={{ minHeight: 32, padding: '4px 10px', fontSize: 13 }}>
                💰 {formatNaira(v.total)}
              </span>
            )}
            {dep && v.deposit && (
              <span className="pd-copy-chip" style={{ minHeight: 32, padding: '4px 10px', fontSize: 13 }}>
                ⏳ Deposit: {formatNaira(v.deposit)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Draft Ticket Preview (Spec Section 5.4) */}
      <div style={{ marginBottom: 24 }}>
        <article
          className="pd-ticket pd-ticket--draft"
          style={{ padding: 0 }}
        >
          <div className="pd-ticket__top">
            <div className="pd-ticket__who">
              <h3>{form.name.trim() || 'Customer Name'}</h3>
              <p>{form.service.trim() || 'Service description'}</p>
            </div>
            <span className="pd-tag pd-tag--draft">Draft Ticket Preview</span>
          </div>

          <div className="pd-ticket__cut" aria-hidden="true">
            <i />
            <i />
          </div>

          {/* Stubs Preview: In full (1 stub) or Deposit+balance (2 stubs side by side) */}
          <div className="pd-ticket__bottom" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {!dep ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--paper-muted)', display: 'block' }}>
                    Pay in full
                  </span>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26 }}>
                    {v.total ? formatNaira(v.total) : '₦0.00'}
                  </div>
                </div>
                <span className="pd-tag pd-tag--waiting">Will issue dynamic account</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Deposit Stub */}
                <div
                  style={{
                    background: 'var(--tag-copied-bg)',
                    borderRadius: 12,
                    padding: '12px 14px',
                    border: '1.5px solid var(--calm)',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--calm)' }}>
                    Deposit · Pay now
                  </span>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, margin: '4px 0 0' }}>
                    {v.deposit ? formatNaira(v.deposit) : '₦0.00'}
                  </div>
                </div>

                {/* Balance Stub */}
                <div
                  style={{
                    background: 'rgba(20, 24, 63, 0.04)',
                    borderRadius: 12,
                    padding: '12px 14px',
                    border: '1.5px dashed var(--line-strong)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--paper-muted)' }}>
                    Balance · {form.due ? `Due ${form.due}` : 'No account yet'}
                  </span>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, margin: '4px 0 0', color: 'var(--paper-muted)' }}>
                    {remainingBalanceKobo ? formatNaira(remainingBalanceKobo) : '₦0.00'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </article>
      </div>

      {/* Form Fields */}
      <form
        className="pd-stack pd-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          go(true);
        }}
        style={{
          background: 'var(--paper)',
          padding: '24px 22px',
          borderRadius: 'var(--r-ticket)',
          boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
          color: 'var(--paper-ink)',
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, margin: '0 0 14px' }}>
          Details (edit if needed)
        </h2>

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
            <div className="pd-presetcustomer" style={{ marginBottom: 12 }}>
              <p>
                {known ? (
                  <>
                    For <strong>{known.name}</strong> · {formatPhone(known.phone)}
                  </>
                ) : (
                  'Loading customer…'
                )}
              </p>
              <Link to="/new" style={{ color: 'var(--ground)' }}>
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
              error={err('name')}
              autoComplete="off"
            />

            {/* Customer Autocomplete Slips (Spec Section 5.4) */}
            {customerSuggestions.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  marginTop: -6,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--paper-muted)' }}>
                  Matching customers:
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
              label="Phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => edit('phone', e.target.value)}
              error={err('phone')}
              hint="Any Nigerian format works."
              autoComplete="off"
            />
          </>
        )}

        <TextField
          label="Service"
          value={form.service}
          onChange={(e) => edit('service', e.target.value)}
          error={err('service')}
          maxLength={120}
        />

        <Segmented<Plan>
          legend="How will they pay?"
          value={form.plan}
          onChange={(p) => edit('plan', p)}
          options={[
            { value: 'FULL', label: 'In full' },
            { value: 'DEPOSIT_BALANCE', label: 'Deposit + balance' },
          ]}
        />

        <TextField
          label={dep ? 'Total price (₦)' : 'Amount (₦)'}
          inputMode="decimal"
          value={form.total}
          onChange={(e) => edit('total', e.target.value)}
          error={err('total')}
          hint={
            v.total
              ? `Customer pays ${formatNaira(v.total)}`
              : 'Type 50000, 50,000 or 50k'
          }
        />

        {dep && (
          <>
            <TextField
              label="Deposit (₦)"
              inputMode="decimal"
              value={form.deposit}
              onChange={(e) => edit('deposit', e.target.value)}
              error={err('deposit')}
              hint={
                assumed.includes('deposit') && !touched.current.has('deposit')
                  ? 'Two amounts found; assumed smaller is the deposit.'
                  : v.deposit
                    ? `Deposit ${formatNaira(v.deposit)}, balance ${v.total ? formatNaira((BigInt(v.total) - BigInt(v.deposit)).toString()) : '…'}`
                    : undefined
              }
            />
            <TextField
              label="Balance due (optional)"
              type="date"
              value={form.due}
              onChange={(e) => edit('due', e.target.value)}
              error={err('due')}
              hint="Listed on Today when due."
            />
          </>
        )}

        {create.isError && !Object.keys(server).length && (
          <Banner tone="bad">{describeError(create.error).message}</Banner>
        )}

        {/* Primary Action Button: The Pressed Key (Spec Section 5.4 & 4.3) */}
        <div style={{ marginTop: 10 }}>
          <button
            type="submit"
            className="pd-btn-primary pd-btn--block"
            disabled={create.isPending}
          >
            {create.isPending ? 'Generating details…' : 'Create and get payment details'}
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
            This starts the account’s 60-minute countdown. Have your chat with {firstName} open.
          </p>
        </div>

        {/* Secondary & Tertiary Outcomes (Spec Reconciliation #7) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            marginTop: 8,
          }}
        >
          <button
            type="button"
            className="pd-btn pd-btn--quiet"
            onClick={() => go(false)}
          >
            Save as draft
          </button>
        </div>
      </form>
    </div>
  );
}

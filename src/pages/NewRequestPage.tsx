import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { customersApi, jobsApi, requestsApi } from '../api/endpoints';
import type { CreateJobBody, RequestWithMessage } from '../contract/contract';
import { useShare } from '../features/share/ShareProvider';
import { useDocumentTitle } from '../lib/hooks';
import { formatNaira, parseNairaInput } from '../lib/money';
import { isValidNgPhone, parseQuickEntry } from '../lib/quickEntry';
import type { QuickEntry } from '../lib/quickEntry';
import { formatPhone } from '../lib/phone';
import { lagosDateToIso } from '../lib/time';
import { Banner, Button, Segmented, TextField } from '../ui/primitives';
import { useToast } from '../ui/Toast';

type Plan = 'FULL' | 'DEPOSIT_BALANCE';
interface Form { name: string; phone: string; service: string; total: string; plan: Plan; deposit: string; due: string }
type Errors = Partial<Record<keyof Form, string>>;

const EMPTY: Form = { name: '', phone: '', service: '', total: '', plan: 'FULL', deposit: '', due: '' };
const asField = (kobo: string | null) => (kobo ? formatNaira(kobo, 'auto').replace('₦', '') : '');

function validate(f: Form, hasCustomer: boolean): { e: Errors; total: string | null; deposit: string | null } {
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
    else if (total && BigInt(deposit) >= BigInt(total)) e.deposit = 'The deposit must be less than the total';
  }
  return { e, total, deposit };
}

const SERVER_KEYS: Record<string, keyof Form> = {
  'customer.name': 'name', 'customer.phone': 'phone', customer: 'name', service: 'service',
  totalKobo: 'total', depositKobo: 'deposit', balanceDueAt: 'due',
};

export function NewRequestPage() {
  useDocumentTitle('New request');
  const nav = useNavigate();
  const qc = useQueryClient();
  const share = useShare();
  const toast = useToast();
  const [text, setText] = useState('');
  const [form, setForm] = useState<Form>(EMPTY);
  const [assumed, setAssumed] = useState<QuickEntry['assumed']>([]);
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<Errors>({});
  const touched = useRef(new Set<keyof Form>());
  // Arriving from a customer page: the customer is already known, so name and phone aren't asked for.
  const [params] = useSearchParams();
  const customerId = params.get('customerId');
  const preset = useQuery({ queryKey: ['customer', customerId], queryFn: () => customersApi.get(customerId!), enabled: !!customerId });
  const known = preset.data?.customer;

  function onText(value: string) {
    setText(value);
    const p = parseQuickEntry(value);
    setAssumed(p.assumed);
    setForm((f) => {
      const n = { ...f };
      const set = <K extends keyof Form>(k: K, v: Form[K]) => { if (!touched.current.has(k)) n[k] = v; };
      set('name', p.name); set('phone', p.phone); set('service', p.service); set('total', asField(p.totalKobo));
      set('plan', p.plan); set('deposit', asField(p.depositKobo)); set('due', p.balanceDueDate ?? '');
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

  const create = useMutation({
    mutationFn: async (sendNow: boolean) => {
      const body: CreateJobBody = {
        ...(customerId ? { customerId } : { customer: { name: form.name.trim(), phone: form.phone.trim() } }),
        service: form.service.trim(), totalKobo: v.total!, plan: form.plan,
        ...(form.plan === 'DEPOSIT_BALANCE'
          ? { depositKobo: v.deposit!, balanceDueAt: form.due ? lagosDateToIso(form.due) : null } : {}),
      };
      const job = await jobsApi.create(body);
      let sent: RequestWithMessage | null = null;
      let sendErr: unknown = null;
      if (sendNow && job.openRequest) {
        try { sent = await requestsApi.send(job.openRequest.id); } catch (e) { sendErr = e; }
      }
      return { job, sent, sendErr };
    },
    onSuccess: ({ job, sent, sendErr }) => {
      void qc.invalidateQueries({ queryKey: ['today'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      nav(`/jobs/${job.id}`);
      if (sent?.message) share.open({ title: `Send to ${job.customer.name.split(' ')[0]}`, message: sent.message, request: sent.request });
      else if (sendErr) toast.error(`Job saved, but ${describeError(sendErr).message} Tap “Send now” to retry.`);
    },
    onError: (e) => {
      const d = describeError(e);
      if (d.fieldErrors) {
        const s: Errors = {};
        for (const [k, msgs] of Object.entries(d.fieldErrors)) { const f = SERVER_KEYS[k]; if (f && msgs[0]) s[f] = msgs[0]; }
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
    <>
      <header className="pd-pagehead"><h1>New request</h1><p className="pd-sub">Type it the way you’d say it in chat.</p></header>

      <div className="pd-field">
        <label className="pd-label" htmlFor="pd-quick">Quick entry</label>
        <textarea id="pd-quick" className="pd-input pd-input--area" rows={3} value={text} autoFocus
          onChange={(e) => onText(e.target.value)} placeholder="Tolu 0803 123 4567 bridal makeup 50k, 25k deposit, balance friday" />
        <p className="pd-hint">Paidar fills in the details below. Nothing is sent until you say so.</p>
      </div>

      <form className="pd-stack pd-form" noValidate onSubmit={(e) => { e.preventDefault(); go(true); }}>
        <h2 className="pd-formhead">Check the details</h2>
        {customerId ? (
          preset.isError
            ? <Banner tone="bad" action={<Link className="pd-btn pd-btn--line" to="/new"><span>Start fresh</span></Link>}>{describeError(preset.error).message}</Banner>
            : <div className="pd-presetcustomer">
                <p>{known ? <>For <strong>{known.name}</strong> · {formatPhone(known.phone)}</> : 'Loading customer…'}</p>
                <Link to="/new">Someone else</Link>
              </div>
        ) : (
          <>
            <TextField label="Customer name" value={form.name} onChange={(e) => edit('name', e.target.value)} error={err('name')} autoComplete="off" />
            <TextField label="Phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => edit('phone', e.target.value)}
              error={err('phone')} hint="Any Nigerian format works." autoComplete="off" />
          </>
        )}
        <TextField label="Service" value={form.service} onChange={(e) => edit('service', e.target.value)} error={err('service')} maxLength={120} />
        <Segmented<Plan> legend="How will they pay?" value={form.plan} onChange={(p) => edit('plan', p)}
          options={[{ value: 'FULL', label: 'In full' }, { value: 'DEPOSIT_BALANCE', label: 'Deposit + balance' }]} />
        <TextField label={dep ? 'Total price (₦)' : 'Amount (₦)'} inputMode="decimal" value={form.total}
          onChange={(e) => edit('total', e.target.value)} error={err('total')}
          hint={v.total ? `Customer pays ${formatNaira(v.total)}` : 'Type 50000, 50,000 or 50k'} />
        {dep && (
          <>
            <TextField label="Deposit (₦)" inputMode="decimal" value={form.deposit} onChange={(e) => edit('deposit', e.target.value)}
              error={err('deposit')}
              hint={assumed.includes('deposit') && !touched.current.has('deposit')
                ? 'Two amounts found, so Paidar assumed the smaller one is the deposit. Check it.'
                : v.deposit ? `Deposit ${formatNaira(v.deposit)}, balance ${v.total ? formatNaira((BigInt(v.total) - BigInt(v.deposit)).toString()) : '…'}` : undefined} />
            <TextField label="Balance due (optional)" type="date" value={form.due} onChange={(e) => edit('due', e.target.value)}
              error={err('due')} hint="Paidar will list the balance on Today when it’s due." />
          </>
        )}
        {create.isError && !Object.keys(server).length && <Banner tone="bad">{describeError(create.error).message}</Banner>}
        <div className="pd-actions pd-actions--stack">
          <Button type="submit" block busy={create.isPending && create.variables === true}>Create and get payment details</Button>
          <Button type="button" variant="line" block busy={create.isPending && create.variables === false} onClick={() => go(false)}>Save without sending</Button>
        </div>
      </form>
    </>
  );
}

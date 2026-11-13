import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../../api/client';
import { describeError } from '../../api/errors';
import { customersApi } from '../../api/endpoints';
import type { Customer, ImportResult } from '../../contract/contract';
import { inspectCsv } from '../../lib/csv';
import { isValidNgPhone } from '../../lib/quickEntry';
import { formatPhone } from '../../lib/phone';
import { Dialog } from '../../ui/Dialog';
import { Banner, Button, TextField } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

function useRefreshCustomers() {
  const qc = useQueryClient();
  return () => Promise.all(['customers', 'customer', 'jobs'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
const existingId = (e: unknown): string | null =>
  e instanceof ApiRequestError && e.code === 'CONFLICT'
    ? ((e.details as { existingId?: string } | undefined)?.existingId ?? null) : null;

/* Forms mount only while their dialog is open, so each opening starts clean. */

export function AddCustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Add a customer"><CustomerForm onDone={onClose} /></Dialog>;
}
export function EditCustomerDialog({ customer, open, onClose }: { customer: Customer; open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Edit customer"><CustomerForm customer={customer} onDone={onClose} /></Dialog>;
}

function CustomerForm({ customer, onDone }: { customer?: Customer; onDone: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefreshCustomers();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer ? formatPhone(customer.phone) : '');
  const [tried, setTried] = useState(false);

  const save = useMutation({
    mutationFn: () => customer
      ? customersApi.update(customer.id, { name: name.trim(), phone: phone.trim() })
      : customersApi.create({ name: name.trim(), phone: phone.trim() }),
    onSuccess: (c) => {
      void refresh();
      toast.success(customer ? 'Customer updated.' : 'Customer saved.');
      onDone();
      if (!customer) nav(`/people/${c.id}`);
    },
  });
  const err = describeError(save.error);
  const dup = existingId(save.error);
  const nameErr = err.fieldErrors?.name?.[0] ?? (tried && !name.trim() ? 'Enter the customer’s name' : undefined);
  const phoneErr = err.fieldErrors?.phone?.[0] ?? (tried && !isValidNgPhone(phone) ? 'Use a Nigerian number like 0803 123 4567' : undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (name.trim() && isValidNgPhone(phone)) save.mutate();
  }
  return (
    <form className="pd-stack" onSubmit={submit} noValidate>
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={nameErr} autoFocus autoComplete="off" />
      <TextField label="Phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={phoneErr}
        hint="Any Nigerian format works." autoComplete="off" />
      {save.isError && (dup
        ? <Banner tone="warn" action={<Button type="button" variant="line" onClick={() => { onDone(); nav(`/people/${dup}`); }}>View</Button>}>{err.message}</Banner>
        : !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>)}
      <div className="pd-actions">
        <Button type="submit" busy={save.isPending}>{customer ? 'Save changes' : 'Save customer'}</Button>
        <Button type="button" variant="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

const SAMPLE = 'name,phone\nTolu Adeyemi,0803 123 4567\nAda Okafor,08099998888';

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Import customers"><ImportForm onDone={onClose} /></Dialog>;
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const refresh = useRefreshCustomers();
  const [csv, setCsv] = useState('');
  const [fileErr, setFileErr] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const check = csv.trim() ? inspectCsv(csv) : null;

  const run = useMutation({
    mutationFn: () => customersApi.importCsv(csv),
    onSuccess: (r) => { setResult(r); void refresh(); },
  });
  const err = describeError(run.error);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) { setFileErr('That file is over 1 MB. Split it into smaller lists.'); return; }
    setFileErr('');
    setCsv(await f.text());
  }

  if (result) {
    return (
      <div className="pd-stack">
        <p className="pd-lede">
          <strong>{result.created}</strong> saved{result.skipped ? `, ${result.skipped} skipped (already saved)` : ''}
          {result.errors.length ? `, ${result.errors.length} need fixing` : ''}.
        </p>
        {result.errors.length > 0 && (
          <div>
            <p className="pd-label">Fix these lines and import again</p>
            <ul className="pd-errlist">
              {result.errors.map((e) => <li key={e.line}><strong>Line {e.line}</strong> {e.message}</li>)}
            </ul>
            <p className="pd-hint">People already saved are skipped, so it’s safe to import the same file again.</p>
          </div>
        )}
        <div className="pd-actions">
          <Button onClick={onDone}>Done</Button>
          {result.errors.length > 0 && <Button variant="line" onClick={() => setResult(null)}>Back to the list</Button>}
        </div>
      </div>
    );
  }

  return (
    <form className="pd-stack" noValidate onSubmit={(e) => { e.preventDefault(); if (check?.ok) run.mutate(); }}>
      <p className="pd-lede">Paste your list or choose a CSV file. The first line must be a header: <code>name,phone</code>.</p>
      <div className="pd-field">
        <label className="pd-label" htmlFor="pd-csv">Your list</label>
        <textarea id="pd-csv" className="pd-input pd-input--area pd-input--mono" rows={6} value={csv} spellCheck={false}
          placeholder={SAMPLE} onChange={(e) => setCsv(e.target.value)} />
        {check && <p className={check.ok ? 'pd-hint' : 'pd-error'} role="status">{check.ok ? `${check.rows} ${check.rows === 1 ? 'person' : 'people'} found` : check.message}</p>}
        {fileErr && <p className="pd-error" role="alert">{fileErr}</p>}
      </div>
      <div className="pd-actions">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="pd-sr-only" onChange={(e) => void pick(e)} aria-label="Choose a CSV file" />
        <Button type="button" variant="line" onClick={() => fileRef.current?.click()}>Choose a file</Button>
        <Button type="button" variant="quiet" onClick={() => setCsv(SAMPLE)}>Use an example</Button>
      </div>
      {run.isError && <Banner tone="bad">{err.fieldErrors?.csv?.[0] ?? err.message}</Banner>}
      <div className="pd-actions">
        <Button type="submit" busy={run.isPending} disabled={!check?.ok}>Import</Button>
        <Button type="button" variant="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { meApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import type { ReadyRule } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { READY_RULE } from '../lib/labels';
import { markOnboarded } from '../lib/onboarding';
import { LogoMark } from '../ui/Logo';
import { Banner, Button, ChoiceCards, Switch, TextField } from '../ui/primitives';

export function OnboardingPage() {
  useDocumentTitle('Set up your business');
  const { provider } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(provider?.businessName ?? '');
  const [rule, setRule] = useState<ReadyRule>(provider?.defaultReadyRule ?? 'AFTER_DEPOSIT');
  const [digestOn, setDigestOn] = useState(true);
  const [digestTime, setDigestTime] = useState('19:30');

  const save = useMutation({
    mutationFn: meApi.update,
    onSuccess: (p) => qc.setQueryData(ME_KEY, p),
  });

  if (!provider) return null;
  const err = describeError(save.error);

  function next(body?: Parameters<typeof meApi.update>[0]) {
    if (body) {
      save.mutate(body, { onSuccess: () => setStep((s) => s + 1) });
    } else {
      setStep((s) => s + 1);
    }
  }

  function finish() {
    save.mutate({ defaultReadyRule: rule, digestTime: digestOn ? digestTime : null }, {
      onSuccess: () => {
        markOnboarded(provider!.id);
        nav('/today', { replace: true });
      },
    });
  }

  return (
    <div className="pd-onboard">
      <header className="pd-onboard__head">
        <LogoMark size={32} />
        <p aria-live="polite">Step {step} of 3</p>
      </header>

      {step === 1 && (
        <form className="pd-onboard__body" onSubmit={(e) => { e.preventDefault(); next({ businessName: name.trim() }); }}>
          <h1>What should customers see?</h1>
          <p className="pd-lede">This name appears on every payment page and receipt, so make it the one they know you by.</p>
          <TextField label="Business name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
            error={err.fieldErrors?.businessName?.[0]} autoComplete="organization" />
          <p className="pd-hint">
            Customers will see: Pay ₦25,000 to <strong>{name.trim() || 'Your Business'}</strong>
          </p>
          {save.isError && !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>}
          <Button type="submit" busy={save.isPending} disabled={!name.trim()} block>Continue</Button>
        </form>
      )}

      {step === 2 && (
        <div className="pd-onboard__body">
          <h1>How payments work</h1>
          <p className="pd-lede">Paidar keeps you in full control of customer communication:</p>

          <div className="pd-stack pd-gap">
            <div className="pd-card">
              <strong>1. One-time bank account</strong>
              <p className="pd-hint">For each payment, Paidar creates a unique virtual account via Wema Bank, valid for 60 minutes. You never share your personal account details.</p>
            </div>
            <div className="pd-card">
              <strong>2. You send the details</strong>
              <p className="pd-hint">Paidar never contacts your customer directly. You copy the payment link or account numbers and paste them into WhatsApp or Instagram DM.</p>
            </div>
            <div className="pd-card">
              <strong>3. Instant bank confirmation</strong>
              <p className="pd-hint">When the customer pays, Kora verifies it instantly. Your dashboard marks it paid in real-time with an official digital receipt.</p>
            </div>
          </div>

          <Button onClick={() => next()} block>Continue</Button>
        </div>
      )}

      {step === 3 && (
        <div className="pd-onboard__body">
          <h1>Operating Rules & Summary</h1>
          <p className="pd-lede">Configure when your jobs are marked ready to start and your daily recap.</p>

          <ChoiceCards legend="Ready to start policy" value={rule} onChange={setRule}
            options={(Object.keys(READY_RULE) as ReadyRule[]).map((v) => ({ value: v, ...READY_RULE[v] }))} />

          <div className="pd-row" style={{ marginTop: 12 }}>
            <div>
              <h2 className="pd-row__title">Evening summary</h2>
              <p className="pd-hint">Daily recap of who paid, who’s waiting, and who to follow up.</p>
            </div>
            <Switch checked={digestOn} onChange={setDigestOn} label="Evening summary" />
          </div>

          {digestOn && (
            <TextField label="Send it at" type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)}
              error={err.fieldErrors?.digestTime?.[0]} />
          )}

          {save.isError && <Banner tone="bad">{err.message}</Banner>}
          <Button busy={save.isPending} onClick={finish} block>Finish setup and launch dashboard</Button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { meApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import type { ReadyRule } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { READY_RULE } from '../lib/labels';
import { markOnboarded } from '../lib/onboarding';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';
import { Banner, Button, ChoiceCards, Switch, TextField } from '../ui/primitives';

export function OnboardingPage() {
  useDocumentTitle('Set up');
  const { provider } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(provider?.businessName ?? '');
  const [rule, setRule] = useState<ReadyRule>(provider?.defaultReadyRule ?? 'AFTER_DEPOSIT');
  const [digestOn, setDigestOn] = useState(true);
  const [digestTime, setDigestTime] = useState('19:30');
  const [waitingTg, setWaitingTg] = useState(false);

  const save = useMutation({
    mutationFn: meApi.update,
    onSuccess: (p) => qc.setQueryData(ME_KEY, p),
  });
  const link = useMutation({
    mutationFn: meApi.telegramLink,
    onSuccess: (r) => { window.open(r.url, '_blank', 'noopener'); setWaitingTg(true); },
  });

  useEffect(() => {
    if (!waitingTg || provider?.telegramLinked) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ME_KEY }), 3000);
    const stop = setTimeout(() => setWaitingTg(false), 90_000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [waitingTg, provider?.telegramLinked, qc]);

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
    save.mutate({ digestTime: digestOn ? digestTime : null }, {
      onSuccess: () => { markOnboarded(provider!.id); nav('/today', { replace: true }); },
    });
  }

  return (
    <div className="pd-onboard">
      <header className="pd-onboard__head">
        <LogoMark size={32} />
        <p aria-live="polite">Step {step} of 4</p>
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
              <p className="pd-hint">For each payment, Paidar creates a unique virtual account via Kora, valid for 60 minutes. You never have to share your personal account.</p>
            </div>
            <div className="pd-card">
              <strong>2. You send the details</strong>
              <p className="pd-hint">Paidar never contacts your customer. You copy the message or account details and send them yourself in chat.</p>
            </div>
            <div className="pd-card">
              <strong>3. Instant bank confirmation</strong>
              <p className="pd-hint">When the customer pays, Kora verifies it instantly. You get a Telegram alert and your dashboard marks it paid.</p>
            </div>
          </div>

          <Button onClick={() => next()} block>Continue</Button>
        </div>
      )}

      {step === 3 && (
        <div className="pd-onboard__body">
          <h1>When can you start work?</h1>
          <p className="pd-lede">Paidar shows a “Ready to start” badge once this is met. You can still set it per job.</p>
          <ChoiceCards legend="Ready to start" value={rule} onChange={setRule}
            options={(Object.keys(READY_RULE) as ReadyRule[]).map((v) => ({ value: v, ...READY_RULE[v] }))} />
          {save.isError && <Banner tone="bad">{err.message}</Banner>}
          <Button busy={save.isPending} onClick={() => next({ defaultReadyRule: rule })} block>Continue</Button>
        </div>
      )}

      {step === 4 && (
        <div className="pd-onboard__body">
          <h1>Hear it the moment it lands</h1>
          <p className="pd-lede">Paidar pings you on Telegram when a payment is confirmed — alerts to you only. Paidar never contacts your customers.</p>

          <div className="pd-row">
            <div>
              <h2 className="pd-row__title">Telegram</h2>
              <p className="pd-hint">{provider.telegramLinked ? 'Connected. You’ll get payment pings there.' : 'Not connected yet.'}</p>
            </div>
            {provider.telegramLinked
              ? <span className="pd-trust pd-trust--verified"><Icon name="check" size={14} />Connected</span>
              : <Button variant="line" icon="send" busy={link.isPending || waitingTg} onClick={() => link.mutate()}>
                  {waitingTg ? 'Waiting for you…' : 'Connect'}
                </Button>}
          </div>

          <div className="pd-row">
            <div>
              <h2 className="pd-row__title">Evening summary</h2>
              <p className="pd-hint">Who paid, who’s waiting, who to follow up.</p>
            </div>
            <Switch checked={digestOn} onChange={setDigestOn} label="Evening summary" />
          </div>
          {digestOn && <TextField label="Send it at" type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)}
            error={err.fieldErrors?.digestTime?.[0]} />}

          {save.isError && !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>}
          <Button busy={save.isPending} onClick={finish} block>Finish setup</Button>
          <p className="pd-hint pd-center">You can connect Telegram later in Settings.</p>
        </div>
      )}
    </div>
  );
}

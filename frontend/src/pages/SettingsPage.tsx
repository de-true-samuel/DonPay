import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { meApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import type { ReadyRule } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { READY_RULE } from '../lib/labels';
import { Icon } from '../ui/Icon';
import { API_URL, MOCK } from '../config';
import { CONTRACT_VERSION } from '../contract/contract';
import { useInstall } from '../pwa/usePwa';
import { useTheme } from '../theme/theme';
import type { ThemePref } from '../theme/theme';
import { Banner, Button, ChoiceCards, Segmented, Switch, TextField } from '../ui/primitives';

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { provider, signOut } = useAuth();
  const theme = useTheme();
  const install = useInstall();
  const qc = useQueryClient();
  const [name, setName] = useState(provider?.businessName ?? '');
  const [rule, setRule] = useState<ReadyRule>(provider?.defaultReadyRule ?? 'AFTER_DEPOSIT');
  const [digestOn, setDigestOn] = useState(provider?.digestTime != null);
  const [digestTime, setDigestTime] = useState(provider?.digestTime ?? '19:30');
  const [saved, setSaved] = useState(false);
  const [waitingTg, setWaitingTg] = useState(false);

  const save = useMutation({
    mutationFn: () => meApi.update({
      businessName: name.trim(), defaultReadyRule: rule, digestTime: digestOn ? digestTime : null,
    }),
    onSuccess: (p) => { qc.setQueryData(ME_KEY, p); setSaved(true); },
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
  const dirty = name.trim() !== provider.businessName
    || rule !== provider.defaultReadyRule
    || (digestOn ? digestTime : null) !== provider.digestTime;
  const err = describeError(save.error);

  return (
    <>
      <header className="pd-pagehead"><h1>Settings</h1></header>

      <form className="pd-stack" onSubmit={(e) => { e.preventDefault(); setSaved(false); save.mutate(); }}>
        <section className="pd-section" aria-labelledby="s-biz">
          <h2 id="s-biz">Business</h2>
          <TextField label="Business name" value={name} maxLength={80}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            hint="Shown on payment pages and receipts." error={err.fieldErrors?.businessName?.[0]} />
          <ChoiceCards legend="Ready to start" value={rule} onChange={(v) => { setRule(v); setSaved(false); }}
            options={(Object.keys(READY_RULE) as ReadyRule[]).map((v) => ({ value: v, ...READY_RULE[v] }))} />
        </section>

        <section className="pd-section" aria-labelledby="s-alerts">
          <h2 id="s-alerts">Alerts</h2>
          <div className="pd-row">
            <div>
              <p className="pd-row__title">Telegram</p>
              <p className="pd-hint">
                {provider.telegramLinked
                  ? 'Connected. Payment pings arrive here (alerts to you only; Paidar never messages customers).'
                  : 'Not connected. You won’t get payment alerts.'}
              </p>
            </div>
            {provider.telegramLinked
              ? <span className="pd-trust pd-trust--verified"><Icon name="check" size={14} />Connected</span>
              : <Button type="button" variant="line" icon="send" busy={link.isPending || waitingTg} onClick={() => link.mutate()}>
                  {waitingTg ? 'Waiting for you…' : 'Connect'}
                </Button>}
          </div>
          <div className="pd-row">
            <div>
              <p className="pd-row__title">Evening summary</p>
              <p className="pd-hint">Who paid, who’s waiting, who to follow up.</p>
            </div>
            <Switch checked={digestOn} onChange={(v) => { setDigestOn(v); setSaved(false); }} label="Evening summary" />
          </div>
          {digestOn && <TextField label="Send it at" type="time" value={digestTime}
            onChange={(e) => { setDigestTime(e.target.value); setSaved(false); }} error={err.fieldErrors?.digestTime?.[0]} />}
        </section>

        {save.isError && !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>}
        <div className="pd-savebar">
          <Button type="submit" busy={save.isPending} disabled={!dirty || !name.trim()}>Save changes</Button>
          <span className="pd-hint" role="status" aria-live="polite">{saved && !dirty ? 'Saved' : ''}</span>
        </div>
      </form>

      <section className="pd-section" aria-labelledby="s-how">
        <h2 id="s-how">How payments work</h2>
        <div className="pd-stack pd-gap">
          <div className="pd-card">
            <strong>Provider-controlled delivery</strong>
            <p className="pd-hint">Paidar never messages your customers directly. When you create payment details, you copy the message or account details and paste them to your customer.</p>
          </div>
          <div className="pd-card">
            <strong>Dynamic virtual accounts</strong>
            <p className="pd-hint">Each request generates a one-time Wema Bank virtual account via Kora, valid for 60 minutes. You never share your personal account details.</p>
          </div>
          <div className="pd-card">
            <strong>Automated verification</strong>
            <p className="pd-hint">Kora verifies bank transfers directly. The moment your customer pays, Paidar receives confirmation and alerts you on Telegram.</p>
          </div>
        </div>
      </section>

      <section className="pd-section" aria-labelledby="s-look">
        <h2 id="s-look">Appearance</h2>
        <Segmented<ThemePref> legend="Theme" value={theme.pref} onChange={theme.setPref}
          options={[{ value: 'system', label: 'Match device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </section>

      <section className="pd-section" aria-labelledby="s-app">
        <h2 id="s-app">On your phone</h2>
        {install.standalone
          ? <p className="pd-lede">Paidar is installed on this device.</p>
          : install.canPrompt
            ? <><p className="pd-lede">Install Paidar to open it from your home screen, like any other app.</p><div><Button icon="plus" onClick={() => void install.prompt()}>Install Paidar</Button></div></>
            : install.iosHint
              ? <p className="pd-lede">On iPhone: tap the Share button, then “Add to Home Screen”.</p>
              : <p className="pd-lede">In your browser’s menu, choose “Install app” or “Add to Home screen”.</p>}
      </section>

      <section className="pd-section" aria-labelledby="s-acct">
        <h2 id="s-acct">Account</h2>
        <Button variant="danger" onClick={() => void signOut()}>Sign out</Button>
        <p className="pd-hint"><Link to="/review">Open Needs review</Link></p>
        {(import.meta.env.DEV) && <p className="pd-hint"><Link to="/kit">Open the design kit</Link></p>}
        <p className="pd-hint">Paidar web · contract {CONTRACT_VERSION} · {MOCK ? 'demo data (no server)' : API_URL || 'same-origin API'}</p>
      </section>
    </>
  );
}

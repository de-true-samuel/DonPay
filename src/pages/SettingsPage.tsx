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
  const [soundPref, setSoundPref] = useState<'bell' | 'drum' | 'silent'>('silent');
  const [confirmBeforeClock, setConfirmBeforeClock] = useState(false);
  const [saved, setSaved] = useState(false);
  const [waitingTg, setWaitingTg] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      meApi.update({
        businessName: name.trim(),
        defaultReadyRule: rule,
        digestTime: digestOn ? digestTime : null,
      }),
    onSuccess: (p) => {
      qc.setQueryData(ME_KEY, p);
      setSaved(true);
    },
  });

  const link = useMutation({
    mutationFn: meApi.telegramLink,
    onSuccess: (r) => {
      window.open(r.url, '_blank', 'noopener');
      setWaitingTg(true);
    },
  });

  useEffect(() => {
    if (!waitingTg || provider?.telegramLinked) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ME_KEY }), 3000);
    const stop = setTimeout(() => setWaitingTg(false), 90_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [waitingTg, provider?.telegramLinked, qc]);

  if (!provider) return null;
  const dirty =
    name.trim() !== provider.businessName ||
    rule !== provider.defaultReadyRule ||
    (digestOn ? digestTime : null) !== provider.digestTime;
  const err = describeError(save.error);

  return (
    <div style={{ maxWidth: 580, margin: '0 auto' }}>
      <header className="pd-pagehead">
        <h1>Settings</h1>
      </header>

      <form
        className="pd-stack"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate();
        }}
      >
        {/* 1. Business Profile (Spec Section 5.12) */}
        <section
          style={{
            background: 'var(--paper)',
            borderRadius: 'var(--r-ticket)',
            padding: '24px 22px',
            color: 'var(--paper-ink)',
            boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 18,
              margin: '0 0 16px',
            }}
          >
            Business profile
          </h2>

          <TextField
            label="Business name"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            hint="Shown on payment links and receipts."
            error={err.fieldErrors?.businessName?.[0]}
          />

          {/* Mini preview */}
          <div
            style={{
              background: 'rgba(20, 24, 63, 0.05)',
              border: '1.5px dashed rgba(20, 24, 63, 0.18)',
              borderRadius: 12,
              padding: '12px 14px',
              margin: '12px 0 16px',
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                color: 'var(--paper-muted)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              Customer Payment Link Preview
            </span>
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 15,
                margin: 0,
              }}
            >
              Pay exactly ₦25,000 to{' '}
              <strong style={{ color: 'var(--ground)' }}>
                {name.trim() || 'Your Business'}
              </strong>
            </p>
          </div>

          <ChoiceCards
            legend="Ready to start policy"
            value={rule}
            onChange={(v) => {
              setRule(v);
              setSaved(false);
            }}
            options={(Object.keys(READY_RULE) as ReadyRule[]).map((v) => ({
              value: v,
              ...READY_RULE[v],
            }))}
          />
        </section>

        {/* 2. Alerts to you only (Spec Section 5.12) */}
        <section
          style={{
            background: 'var(--paper)',
            borderRadius: 'var(--r-ticket)',
            padding: '24px 22px',
            color: 'var(--paper-ink)',
            boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 18,
              margin: '0 0 6px',
            }}
          >
            Alerts to you only
          </h2>
          <p style={{ fontSize: 13, color: 'var(--paper-muted)', margin: '0 0 16px' }}>
            Paidar never messages your customers. All notifications go to you.
          </p>

          {/* Telegram Status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Telegram alerts</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--paper-muted)' }}>
                {provider.telegramLinked
                  ? 'Connected · Instant payment alerts'
                  : 'Receive instant payment pings in Telegram'}
              </p>
            </div>
            {provider.telegramLinked ? (
              <span className="pd-tag pd-tag--paid">Connected ✓</span>
            ) : (
              <Button
                variant="line"
                busy={link.isPending}
                onClick={() => void link.mutate()}
              >
                Connect Telegram
              </Button>
            )}
          </div>

          {/* Evening Summary */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 0',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Evening summary</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--paper-muted)' }}>
                Daily digest of who paid, who owes, and pending requests.
              </p>
            </div>
            <Switch
              checked={digestOn}
              onChange={(v) => {
                setDigestOn(v);
                setSaved(false);
              }}
              label="Evening summary"
            />
          </div>

          {digestOn && (
            <TextField
              label="Send summary at"
              type="time"
              value={digestTime}
              onChange={(e) => {
                setDigestTime(e.target.value);
                setSaved(false);
              }}
              error={err.fieldErrors?.digestTime?.[0]}
            />
          )}

          {/* Paid ping sound (Spec Section 5.12) */}
          <div style={{ marginTop: 16 }}>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--paper-muted)',
                marginBottom: 8,
              }}
            >
              Paid ping sound
            </label>
            <Segmented<'bell' | 'drum' | 'silent'>
              legend="Sound choice"
              value={soundPref}
              onChange={setSoundPref}
              options={[
                { value: 'silent', label: 'Silent' },
                { value: 'bell', label: 'Soft bell' },
                { value: 'drum', label: 'Drum tap' },
              ]}
            />
          </div>

          {/* Ask before starting the clock */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 16,
              borderTop: '1px solid var(--line)',
              marginTop: 16,
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>
                Ask before starting the clock
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--paper-muted)' }}>
                Show confirmation before generating 60-min payment details.
              </p>
            </div>
            <Switch
              checked={confirmBeforeClock}
              onChange={setConfirmBeforeClock}
              label="Ask before starting clock"
            />
          </div>
        </section>

        {save.isError && !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="submit"
            className="pd-btn-primary"
            disabled={!dirty || !name.trim() || save.isPending}
            style={{ minWidth: 160 }}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <span className="pd-hint" role="status" aria-live="polite">
            {saved && !dirty ? '✓ Changes saved' : ''}
          </span>
        </div>
      </form>

      {/* 3. How payments work (Spec Section 5.12) */}
      <section
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          padding: '24px 22px',
          color: 'var(--paper-ink)',
          boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
          marginTop: 24,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 18,
            margin: '0 0 14px',
          }}
        >
          How payments work
        </h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <div
            style={{
              background: 'rgba(20, 24, 63, 0.04)',
              borderRadius: 12,
              padding: '12px 14px',
            }}
          >
            <strong style={{ fontSize: 14 }}>1. You copy</strong>
            <p style={{ fontSize: 13, color: 'var(--paper-muted)', margin: '4px 0 0' }}>
              Paidar prepares the message. You paste it into your chat. Paidar never messages your
              customer.
            </p>
          </div>
          <div
            style={{
              background: 'rgba(20, 24, 63, 0.04)',
              borderRadius: 12,
              padding: '12px 14px',
            }}
          >
            <strong style={{ fontSize: 14 }}>2. They pay</strong>
            <p style={{ fontSize: 13, color: 'var(--paper-muted)', margin: '4px 0 0' }}>
              Your customer pays by ordinary bank transfer. No signup, no card.
            </p>
          </div>
          <div
            style={{
              background: 'rgba(20, 24, 63, 0.04)',
              borderRadius: 12,
              padding: '12px 14px',
            }}
          >
            <strong style={{ fontSize: 14 }}>3. You get pinged</strong>
            <p style={{ fontSize: 13, color: 'var(--paper-muted)', margin: '4px 0 0' }}>
              Kora detects the payment and Paidar tells you the moment it clears.
            </p>
          </div>
        </div>
        <p
          style={{
            fontSize: 12,
            color: 'var(--paper-muted)',
            marginTop: 12,
            marginBottom: 0,
            lineHeight: 1.4,
          }}
        >
          The account is a one-time Kora account for this payment only. It is not your own bank
          account.
        </p>
      </section>

      {/* 4. Appearance (Spec Section 5.12) */}
      <section
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          padding: '24px 22px',
          color: 'var(--paper-ink)',
          boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
          marginTop: 24,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 18,
            margin: '0 0 14px',
          }}
        >
          Appearance
        </h2>
        <Segmented<ThemePref>
          legend="Theme"
          value={theme.pref}
          onChange={theme.setPref}
          options={[
            { value: 'system', label: 'Match device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </section>

      {/* 5. On your phone (Spec Section 5.12) */}
      <section
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          padding: '24px 22px',
          color: 'var(--paper-ink)',
          boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
          marginTop: 24,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 18,
            margin: '0 0 10px',
          }}
        >
          On your phone
        </h2>
        {install.standalone ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ok)', fontWeight: 600 }}>
            ✓ Paidar is installed on this device.
          </p>
        ) : install.canPrompt ? (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--paper-muted)' }}>
              Install Paidar to open it from your home screen with quick access.
            </p>
            <Button icon="plus" onClick={() => void install.prompt()}>
              Install Paidar
            </Button>
          </>
        ) : install.iosHint ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--paper-muted)' }}>
            On iPhone Safari: tap the Share button, then choose <strong>“Add to Home Screen”</strong>.
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--paper-muted)' }}>
            In your browser menu, tap <strong>“Install app”</strong> or <strong>“Add to Home screen”</strong>.
          </p>
        )}
      </section>

      {/* 6. Account (Spec Section 5.12) */}
      <section
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          padding: '24px 22px',
          color: 'var(--paper-ink)',
          boxShadow: '0 8px 24px rgba(16, 21, 77, 0.25)',
          marginTop: 24,
          marginBottom: 40,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 18,
            margin: '0 0 14px',
          }}
        >
          Account
        </h2>
        <Button variant="danger" onClick={() => void signOut()}>
          Sign out
        </Button>
        <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <Link to="/review" style={{ color: 'var(--ground)' }}>
              Open Needs review
            </Link>
          </p>
          {import.meta.env.DEV && (
            <p style={{ margin: 0, fontSize: 13 }}>
              <Link to="/kit" style={{ color: 'var(--ground)' }}>
                Open design kit
              </Link>
            </p>
          )}
          <p style={{ margin: 0, fontSize: 12, color: 'var(--paper-muted)' }}>
            Paidar web · contract {CONTRACT_VERSION} ·{' '}
            {MOCK ? 'demo data (no server)' : API_URL || 'same-origin API'}
          </p>
        </div>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/errors';
import { meApi } from '../api/endpoints';
import { ME_KEY, useAuth } from '../auth/AuthProvider';
import type { ReadyRule } from '../contract/contract';
import { useDocumentTitle } from '../lib/hooks';
import { markOnboarded } from '../lib/onboarding';
import { LogoMark } from '../ui/Logo';
import { Banner, Switch, TextField } from '../ui/primitives';

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
    save.mutate(
      { defaultReadyRule: rule, digestTime: digestOn ? digestTime : null },
      {
        onSuccess: () => {
          markOnboarded(provider!.id);
          nav('/today', { replace: true });
        },
      }
    );
  }

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '32px 20px 60px',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {/* Onboarding Ticket Shell (Spec Section 5.2) */}
      <article
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--r-ticket)',
          boxShadow: '0 24px 36px rgba(16, 21, 77, 0.45)',
          color: 'var(--paper-ink)',
          overflow: 'hidden',
        }}
      >
        {/* Progress: 3 notches along a perforated line at the top (Spec Section 5.2) */}
        <div
          style={{
            padding: '24px 24px 16px',
            borderBottom: '1px dashed rgba(20, 24, 63, 0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LogoMark size={24} />
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 16,
                letterSpacing: '-0.02em',
              }}
            >
              paidar
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                style={{
                  width: s === step ? 22 : 10,
                  height: 10,
                  borderRadius: 999,
                  background:
                    s === step
                      ? 'var(--cta)'
                      : s < step
                        ? 'var(--ground)'
                        : 'rgba(20, 24, 63, 0.16)',
                  transition: 'all 0.2s ease',
                }}
              />
            ))}
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--paper-muted)',
                marginLeft: 4,
              }}
            >
              Step {step} of 3
            </span>
          </div>
        </div>

        {/* STEP 1: Your business (Spec Section 5.2) */}
        {step === 1 && (
          <form
            style={{ padding: '24px 24px 28px', display: 'grid', gap: 20 }}
            onSubmit={(e) => {
              e.preventDefault();
              next({ businessName: name.trim() });
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: '-0.02em',
                  margin: '0 0 6px',
                }}
              >
                Your business
              </h1>
              <p style={{ color: 'var(--paper-muted)', fontSize: 14, margin: 0 }}>
                This name appears on the customer payment link and receipt.
              </p>
            </div>

            <TextField
              label="Business name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tolu’s Glam Studio"
              maxLength={80}
              error={err.fieldErrors?.businessName?.[0]}
              autoComplete="organization"
              autoFocus={typeof window !== 'undefined' && !('ontouchstart' in window)}
            />

            {/* Live Ticket Preview (Spec Section 5.2) */}
            <div
              style={{
                background: 'rgba(20, 24, 63, 0.05)',
                border: '1.5px dashed rgba(20, 24, 63, 0.2)',
                borderRadius: 14,
                padding: '16px 18px',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--paper-muted)',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Customer Ticket Preview
              </span>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 16,
                  color: 'var(--paper-ink)',
                  margin: 0,
                }}
              >
                Pay ₦25,000 to{' '}
                <span style={{ color: 'var(--ground)' }}>
                  {name.trim() || 'Tolu’s Glam Studio'}
                </span>
              </p>
            </div>

            {save.isError && !err.fieldErrors && <Banner tone="bad">{err.message}</Banner>}

            <button
              type="submit"
              className="pd-btn-primary pd-btn--block"
              disabled={save.isPending || !name.trim()}
            >
              {save.isPending ? 'Saving…' : 'Continue'}
            </button>
          </form>
        )}

        {/* STEP 2: How payments work (Spec Section 5.2) */}
        {step === 2 && (
          <div style={{ padding: '24px 24px 28px', display: 'grid', gap: 20 }}>
            <div>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: '-0.02em',
                  margin: '0 0 6px',
                }}
              >
                How payments work
              </h1>
              <p style={{ color: 'var(--paper-muted)', fontSize: 14, margin: 0 }}>
                Three simple steps keeping you in complete control.
              </p>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              {/* Panel 1 */}
              <div
                style={{
                  background: 'rgba(20, 24, 63, 0.04)',
                  border: '1px solid rgba(20, 24, 63, 0.1)',
                  borderRadius: 14,
                  padding: '14px 16px',
                }}
              >
                <h3
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 15,
                    margin: '0 0 4px',
                  }}
                >
                  1. You copy.
                </h3>
                <p style={{ fontSize: 14, color: 'var(--paper-muted)', margin: 0, lineHeight: 1.45 }}>
                  Paidar prepares the message. You paste it into your chat. Paidar never messages
                  your customer.
                </p>
              </div>

              {/* Panel 2 */}
              <div
                style={{
                  background: 'rgba(20, 24, 63, 0.04)',
                  border: '1px solid rgba(20, 24, 63, 0.1)',
                  borderRadius: 14,
                  padding: '14px 16px',
                }}
              >
                <h3
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 15,
                    margin: '0 0 4px',
                  }}
                >
                  2. They pay.
                </h3>
                <p style={{ fontSize: 14, color: 'var(--paper-muted)', margin: 0, lineHeight: 1.45 }}>
                  Your customer pays by ordinary bank transfer. No signup, no card.
                </p>
              </div>

              {/* Panel 3 */}
              <div
                style={{
                  background: 'rgba(20, 24, 63, 0.04)',
                  border: '1px solid rgba(20, 24, 63, 0.1)',
                  borderRadius: 14,
                  padding: '14px 16px',
                }}
              >
                <h3
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 15,
                    margin: '0 0 4px',
                  }}
                >
                  3. You get pinged.
                </h3>
                <p style={{ fontSize: 14, color: 'var(--paper-muted)', margin: 0, lineHeight: 1.45 }}>
                  Kora detects the payment and Paidar tells you the moment it clears.
                </p>
              </div>
            </div>

            <p
              style={{
                fontSize: 13,
                color: 'var(--paper-muted)',
                lineHeight: 1.4,
                margin: '2px 0 0',
                borderLeft: '3px solid var(--cta)',
                paddingLeft: 12,
              }}
            >
              The account is a one-time Kora account for this payment only. It is not your own bank
              account.
            </p>

            <button type="button" className="pd-btn-primary pd-btn--block" onClick={() => next()}>
              Continue
            </button>
          </div>
        )}

        {/* STEP 3: Your rules (Spec Section 5.2) */}
        {step === 3 && (
          <div style={{ padding: '24px 24px 28px', display: 'grid', gap: 20 }}>
            <div>
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: '-0.02em',
                  margin: '0 0 6px',
                }}
              >
                Your rules
              </h1>
              <p style={{ color: 'var(--paper-muted)', fontSize: 14, margin: 0 }}>
                Set when jobs are marked ready to start and daily summaries.
              </p>
            </div>

            {/* Ready to start selector cards */}
            <div style={{ display: 'grid', gap: 10 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--paper-muted)',
                }}
              >
                Ready to start rule
              </label>

              <button
                type="button"
                onClick={() => setRule('AFTER_DEPOSIT')}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '16px 18px',
                  borderRadius: 'var(--r-slip)',
                  background: rule === 'AFTER_DEPOSIT' ? 'var(--tag-copied-bg)' : 'transparent',
                  border: `2px solid ${rule === 'AFTER_DEPOSIT' ? 'var(--calm)' : 'var(--line-strong)'}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--paper-ink)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15 }}>
                    After deposit
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--paper-muted)', marginTop: 2 }}>
                    Work begins once the deposit is paid. Balance is tracked.
                  </div>
                </div>
                {rule === 'AFTER_DEPOSIT' && <span style={{ color: 'var(--calm)' }}>✓</span>}
              </button>

              <button
                type="button"
                onClick={() => setRule('AFTER_FULL')}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '16px 18px',
                  borderRadius: 'var(--r-slip)',
                  background:
                    rule === 'AFTER_FULL' ? 'var(--tag-copied-bg)' : 'transparent',
                  border: `2px solid ${rule === 'AFTER_FULL' ? 'var(--calm)' : 'var(--line-strong)'}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--paper-ink)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15 }}>
                    After full payment
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--paper-muted)', marginTop: 2 }}>
                    Work begins only when 100% of the total amount has cleared.
                  </div>
                </div>
                {rule === 'AFTER_FULL' && <span style={{ color: 'var(--calm)' }}>✓</span>}
              </button>
            </div>

            {/* Evening summary */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 8,
              }}
            >
              <div>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Evening summary</h4>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--paper-muted)' }}>
                  Daily Telegram message: who paid, who owes, what is pending.
                </p>
              </div>
              <Switch checked={digestOn} onChange={setDigestOn} label="Evening summary" />
            </div>

            {digestOn && (
              <TextField
                label="Summary time (Lagos time)"
                type="time"
                value={digestTime}
                onChange={(e) => setDigestTime(e.target.value)}
                error={err.fieldErrors?.digestTime?.[0]}
              />
            )}

            {save.isError && <Banner tone="bad">{err.message}</Banner>}

            <button
              type="button"
              className="pd-btn-primary pd-btn--block"
              disabled={save.isPending}
              onClick={finish}
            >
              {save.isPending ? 'Setting up…' : 'Complete setup'}
            </button>
          </div>
        )}
      </article>
    </div>
  );
}

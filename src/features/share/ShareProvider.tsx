import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PaymentRequest, PreparedMessage } from '../../contract/contract';
import { formatTime } from '../../lib/time';
import { markCopied } from '../requests/copyTracker';
import { CountdownRing } from '../../ui/CountdownRing';
import { Dialog } from '../../ui/Dialog';
import { useToast } from '../../ui/Toast';

export interface SharePayload {
  title: string;
  message: PreparedMessage | string;
  /** When given, the panel shows itemized copy buttons and the live countdown. */
  request?: PaymentRequest;
}

interface ShareApi {
  open: (p: SharePayload) => void;
}

const Ctx = createContext<ShareApi | null>(null);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* try fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function ShareProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [open, setOpen] = useState(false);
  const [copiedState, setCopiedState] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const toast = useToast();

  const api = useMemo<ShareApi>(
    () => ({
      open: (p) => {
        setPayload(p);
        setOpen(true);
        setCopiedState(false);
      },
    }),
    []
  );

  const close = useCallback(() => {
    setOpen(false);
    setCopiedState(false);
  }, []);

  const r = payload?.request;

  const msgObj: PreparedMessage = useMemo(() => {
    if (!payload) return { text: '', whatsappUrl: '', telegramUrl: '', payLink: '' };
    if (typeof payload.message === 'string') {
      const text = payload.message;
      return {
        text,
        whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}`,
        telegramUrl: `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`,
        payLink: payload.request?.payLink ?? '',
      };
    }
    return payload.message;
  }, [payload]);

  const firstName = useMemo(() => {
    if (!payload?.title) return 'Customer';
    const clean = payload.title.replace(/^Payment details for /i, '').trim();
    return clean.split(' ')[0] || 'Customer';
  }, [payload?.title]);

  async function handleCopyMessage() {
    if (!payload) return;
    const ok = await copyText(msgObj.text);
    if (ok) {
      if (r?.id) markCopied(r.id);
      setCopiedState(true);
      toast.success('Message copied');
      setTimeout(() => {
        setCopiedState(false);
      }, 2200);
    } else {
      toast.error('Couldn’t copy. Select the text and copy by hand.');
    }
  }

  async function handleCopyChip(fieldKey: string, value: string, label: string) {
    if (!value) return;
    const ok = await copyText(value);
    if (ok) {
      if (r?.id) markCopied(r.id);
      setCopiedField(fieldKey);
      toast.success(`${label} copied`);
      setTimeout(() => {
        setCopiedField((curr) => (curr === fieldKey ? null : curr));
      }, 1400);
    } else {
      toast.error(`Couldn’t copy ${label}.`);
    }
  }

  function markSentAndClose() {
    if (r?.id) markCopied(r.id);
    toast.success('Details marked as sent');
    close();
  }

  const plainAmount = r ? (BigInt(r.amountKobo) / 100n).toString() : null;

  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog
        open={open}
        onClose={close}
        title={`Copy for ${firstName}`}
      >
        {payload && (
          <div style={{ display: 'grid', gap: 18 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--paper-muted)' }}>
              Copy, paste into your chat with {firstName}, then wait for the ping.
            </p>

            {/* Countdown Dial Area (Spec Section 5.5) */}
            {r && r.sentAt && r.expiresAt && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '8px 0',
                }}
              >
                <div className="pd-ring pd-ring--hero" style={{ width: 100, height: 100 }}>
                  <CountdownRing sentAt={r.sentAt} expiresAt={r.expiresAt} />
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--paper-muted)' }}>
                  The 60-minute clock started at {formatTime(r.sentAt)}.
                </p>
              </div>
            )}

            {/* Chat Bubble Message Preview */}
            <div
              style={{
                background: 'rgba(20, 24, 63, 0.05)',
                border: '1px solid rgba(20, 24, 63, 0.12)',
                borderRadius: 16,
                padding: '14px 16px',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                lineHeight: 1.5,
                color: 'var(--paper-ink)',
                whiteSpace: 'pre-wrap',
                cursor: 'pointer',
              }}
              onClick={() => void copyText(msgObj.text)}
              title="Click to copy whole message"
            >
              {msgObj.text}
            </div>

            {/* Primary Action Button: Copy Message (Spec Section 5.5 & 3.3 B) */}
            <button
              type="button"
              className="pd-btn-primary pd-btn--block"
              style={{
                background: copiedState ? 'var(--ok)' : 'var(--cta)',
                boxShadow: copiedState ? '0 6px 0 #0A6636' : '0 6px 0 var(--cta-edge)',
              }}
              onClick={() => void handleCopyMessage()}
            >
              {copiedState ? 'Copied ✓' : 'Copy message'}
            </button>

            {/* Itemized copy rows with plain values & chips */}
            {r && (
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  padding: '12px 0',
                  borderTop: '1px dashed rgba(20, 24, 63, 0.16)',
                  borderBottom: '1px dashed rgba(20, 24, 63, 0.16)',
                }}
              >
                {r.accountNumber && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--paper-muted)', display: 'block' }}>
                        Account number
                      </span>
                      <strong
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 16,
                          letterSpacing: '0.08em',
                        }}
                      >
                        {r.accountNumber}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className={`pd-copy-chip ${copiedField === 'acc' ? 'pd-copy-chip--copied' : ''}`}
                      onClick={() => void handleCopyChip('acc', r.accountNumber!, 'Account number')}
                    >
                      {copiedField === 'acc' ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                )}

                {plainAmount && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--paper-muted)', display: 'block' }}>
                        Amount (plain digits)
                      </span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 16 }}>
                        {plainAmount}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className={`pd-copy-chip ${copiedField === 'amt' ? 'pd-copy-chip--copied' : ''}`}
                      onClick={() => void handleCopyChip('amt', plainAmount, 'Amount')}
                    >
                      {copiedField === 'amt' ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                )}

                {msgObj.payLink && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--paper-muted)', display: 'block' }}>
                        Payment link
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 13,
                          color: 'var(--paper-ink)',
                        }}
                      >
                        {msgObj.payLink.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`pd-copy-chip ${copiedField === 'link' ? 'pd-copy-chip--copied' : ''}`}
                      onClick={() => void handleCopyChip('link', msgObj.payLink, 'Payment link')}
                    >
                      {copiedField === 'link' ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                )}

                <div style={{ fontSize: 13, color: 'var(--paper-muted)', marginTop: 4 }}>
                  Bank: <strong>{r.bankName ?? 'Wema Bank'}</strong>
                  {r.accountName && (
                    <>
                      {' '}
                      · Name: <strong>{r.accountName}</strong>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Small tertiary chat links (Spec Section 5.5) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                fontSize: 13,
              }}
            >
              <a
                href={msgObj.whatsappUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--ground)', textDecoration: 'underline' }}
              >
                Open in WhatsApp
              </a>
              <span style={{ color: 'var(--line-strong)' }}>·</span>
              <a
                href={msgObj.telegramUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--ground)', textDecoration: 'underline' }}
              >
                Open in Telegram
              </a>
            </div>

            {/* Close control reads "I've sent it" */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="pd-btn pd-btn--line"
                style={{ flex: 1 }}
                onClick={markSentAndClose}
              >
                I’ve sent it
              </button>
              <button
                type="button"
                className="pd-btn pd-btn--quiet"
                onClick={close}
              >
                Close
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 12, color: 'var(--paper-muted)', lineHeight: 1.4 }}>
              This account was made by Kora for this payment only. It isn’t your personal account.
              Pay the exact amount.
            </p>
          </div>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

export function useShare(): ShareApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShare must be used inside <ShareProvider>');
  return v;
}

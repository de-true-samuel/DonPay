import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PaymentRequest, PreparedMessage } from '../../contract/contract';
import { formatTime } from '../../lib/time';
import { markCopied } from '../requests/copyTracker';
import { CopyChip } from '../../ui/CopyChip';
import { CountdownRing } from '../../ui/CountdownRing';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
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
                  padding: '8px 0 12px',
                }}
              >
                <CountdownRing sentAt={r.sentAt} expiresAt={r.expiresAt} size="hero" />
                <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--paper-muted)' }}>
                  The 60-minute clock started at {formatTime(r.sentAt)}.
                </p>
              </div>
            )}

            {/* Chat Bubble Message Preview */}
            <div
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r-md)',
                padding: '14px 16px',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                lineHeight: 1.5,
                color: 'var(--ink-1)',
                whiteSpace: 'pre-wrap',
                cursor: 'pointer',
              }}
              onClick={() => void handleCopyMessage()}
              title="Click to copy whole message"
            >
              {msgObj.text}
            </div>

            {/* Primary Action Button: Copy Message (Volt primary or Mint confirmation display) */}
            {copiedState ? (
              <div
                className="ob-status ob-status--mint"
                style={{ width: '100%', justifyContent: 'center', minHeight: 48, borderRadius: 'var(--r-md)', fontSize: 14 }}
                role="status"
                aria-live="polite"
                data-flow-id="SHR-07"
              >
                <Icon name="shield" size={16} />
                <span>Message copied</span>
              </div>
            ) : (
              <button
                type="button"
                className="pd-btn pd-btn--primary pd-btn--block"
                onClick={() => void handleCopyMessage()}
                data-flow-id="SHR-07"
              >
                <Icon name="copy" size={16} />
                <span>Copy message</span>
              </button>
            )}

            {/* Itemized copy rows with plain values & Ink-flood CopyChips */}
            {r && (
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                  padding: '14px 0',
                  borderTop: '1px dashed var(--line-2)',
                  borderBottom: '1px dashed var(--line-2)',
                }}
              >
                {r.accountNumber && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <span className="ob-overline" style={{ display: 'block' }}>Account number</span>
                      <strong className="pd-mono" style={{ fontSize: 16, letterSpacing: '0.08em', color: 'var(--ink-1)' }}>
                        {r.accountNumber}
                      </strong>
                    </div>
                    <CopyChip
                      value={r.accountNumber}
                      label="Copy"
                      copyLabel="Account number"
                      onCopied={() => { if (r?.id) markCopied(r.id); }}
                    />
                  </div>
                )}

                {plainAmount && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <span className="ob-overline" style={{ display: 'block' }}>Amount (plain digits)</span>
                      <strong className="pd-mono" style={{ fontSize: 16, color: 'var(--ink-1)' }}>{plainAmount}</strong>
                    </div>
                    <CopyChip
                      value={plainAmount}
                      label="Copy"
                      copyLabel="Amount"
                      onCopied={() => { if (r?.id) markCopied(r.id); }}
                    />
                  </div>
                )}

                {msgObj.payLink && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <span className="ob-overline" style={{ display: 'block' }}>Payment link</span>
                      <span className="pd-mono" style={{ fontSize: 12.5, color: 'var(--ink-2)', wordBreak: 'break-all' }}>
                        {msgObj.payLink.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                    <CopyChip
                      value={msgObj.payLink}
                      label="Copy"
                      copyLabel="Payment link"
                      onCopied={() => { if (r?.id) markCopied(r.id); }}
                    />
                  </div>
                )}

                <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
                  Bank: <strong style={{ color: 'var(--ink-1)' }}>{r.bankName ?? 'Wema Bank'}</strong>
                  {r.accountName && (
                    <>
                      {' '}
                      · Name: <strong style={{ color: 'var(--ink-1)' }}>{r.accountName}</strong>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Share & Preview links (SHR-06, SHR-09) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: 14,
                fontSize: 13,
              }}
            >
              <a
                href={msgObj.whatsappUrl}
                target="_blank"
                rel="noreferrer"
                data-flow-id="SHR-06"
                style={{ fontWeight: 600 }}
              >
                Open WhatsApp
              </a>
              <span style={{ color: 'var(--line-3)' }}>·</span>
              <a
                href={msgObj.telegramUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Telegram
              </a>
              {msgObj.payLink && (
                <>
                  <span style={{ color: 'var(--line-3)' }}>·</span>
                  <Link
                    to={`/pay/${msgObj.payLink.split('/').pop()}?preview=1`}
                    onClick={close}
                    data-flow-id="SHR-09"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    Preview as your client
                  </Link>
                </>
              )}
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

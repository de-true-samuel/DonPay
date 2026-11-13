import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PaymentRequest, PreparedMessage } from '../../contract/contract';
import { formatNaira } from '../../lib/money';
import { formatTime } from '../../lib/time';
import { markCopied } from '../requests/copyTracker';
import { CountdownRing } from '../../ui/CountdownRing';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/primitives';
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
    /* try the fallback */
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
  const toast = useToast();

  const api = useMemo<ShareApi>(() => ({
    open: (p) => {
      setPayload(p);
      setOpen(true);
    },
  }), []);

  const close = useCallback(() => setOpen(false), []);

  const go = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

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

  async function copyMessage() {
    if (!payload) return;
    const ok = await copyText(msgObj.text);
    if (ok) {
      if (r?.id) markCopied(r.id);
      toast.success('Message copied');
    } else {
      toast.error('Couldn’t copy. Select the text and copy it by hand.');
    }
  }

  async function copyField(label: string, value: string) {
    if (!value) return;
    const ok = await copyText(value);
    if (ok) {
      if (r?.id) markCopied(r.id);
      toast.success(`${label} copied`);
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
      <Dialog open={open} onClose={close} title={payload?.title ?? 'Payment details'}>
        {payload && (
          <div className="pd-stack">
            {r && r.status === 'SENT' && r.sentAt && r.expiresAt && (
              <div className="pd-sharehead">
                <CountdownRing sentAt={r.sentAt} expiresAt={r.expiresAt} />
                <div>
                  <p>
                    Pay exactly <strong>{formatNaira(r.amountKobo)}</strong>
                  </p>
                  <p className="pd-hint">
                    Started at {formatTime(r.sentAt)}. Valid for 60 minutes.
                  </p>
                </div>
              </div>
            )}

            <div className="pd-actions">
              <Button block onClick={() => void copyMessage()}>
                Copy message
              </Button>
            </div>

            {r && (
              <div className="pd-copyitems" aria-label="Copy individual details">
                {r.accountNumber && (
                  <div className="pd-copyitem">
                    <div className="pd-copyitem__main">
                      <p className="pd-copyitem__label">Account Number</p>
                      <p className="pd-copyitem__val">{r.accountNumber}</p>
                    </div>
                    <Button variant="line" onClick={() => void copyField('Account number', r.accountNumber!)}>
                      Copy
                    </Button>
                  </div>
                )}

                {r.bankName && (
                  <div className="pd-copyitem">
                    <div className="pd-copyitem__main">
                      <p className="pd-copyitem__label">Bank</p>
                      <p className="pd-copyitem__val">{r.bankName}</p>
                    </div>
                    <Button variant="line" onClick={() => void copyField('Bank name', r.bankName!)}>
                      Copy
                    </Button>
                  </div>
                )}

                {r.accountName && (
                  <div className="pd-copyitem">
                    <div className="pd-copyitem__main">
                      <p className="pd-copyitem__label">Account Name</p>
                      <p className="pd-copyitem__val">{r.accountName}</p>
                    </div>
                    <Button variant="line" onClick={() => void copyField('Account name', r.accountName!)}>
                      Copy
                    </Button>
                  </div>
                )}

                {plainAmount && (
                  <div className="pd-copyitem">
                    <div className="pd-copyitem__main">
                      <p className="pd-copyitem__label">Amount (plain digits)</p>
                      <p className="pd-copyitem__val">{plainAmount}</p>
                    </div>
                    <Button variant="line" onClick={() => void copyField('Amount', plainAmount)}>
                      Copy digits
                    </Button>
                  </div>
                )}

                {msgObj.payLink && (
                  <div className="pd-copyitem">
                    <div className="pd-copyitem__main">
                      <p className="pd-copyitem__label">Payment Link</p>
                      <p className="pd-copyitem__val">{msgObj.payLink}</p>
                    </div>
                    <Button variant="line" onClick={() => void copyField('Payment link', msgObj.payLink)}>
                      Copy link
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="pd-label" htmlFor="pd-copy-textarea" id="pd-msg-label">
                The message to copy
              </label>
              <textarea
                id="pd-copy-textarea"
                className="pd-msg"
                readOnly
                rows={5}
                aria-labelledby="pd-msg-label"
                value={msgObj.text}
                onFocus={(e) => e.target.select()}
              />
            </div>

            <div className="pd-actions">
              <Button variant="line" onClick={() => go(msgObj.whatsappUrl)}>
                Open WhatsApp
              </Button>
              <Button variant="line" onClick={() => go(msgObj.telegramUrl)}>
                Telegram
              </Button>
              <Button variant="line" onClick={markSentAndClose}>
                I’ve sent it
              </Button>
              <Button variant="quiet" onClick={close}>
                Done
              </Button>
            </div>

            <p className="pd-hint">
              This is a one-time account for this payment only, not your personal account.
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

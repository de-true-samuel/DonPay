import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PaymentRequest, PreparedMessage } from '../../contract/contract';
import { formatNaira } from '../../lib/money';
import { CountdownRing } from '../../ui/CountdownRing';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

export interface SharePayload {
  title: string;
  message: PreparedMessage;
  /** When given, the sheet shows the amount and the live countdown. */
  request?: PaymentRequest;
}
interface ShareApi { open: (p: SharePayload) => void }
const Ctx = createContext<ShareApi | null>(null);

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function ShareProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const api = useMemo<ShareApi>(() => ({ open: (p) => { setPayload(p); setOpen(true); } }), []);
  const close = useCallback(() => setOpen(false), []);

  const go = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  async function copy() {
    if (!payload) return;
    if (await copyText(payload.message.text)) toast.success('Message copied');
    else toast.error('Couldn’t copy. Select the text and copy it by hand.');
  }

  const r = payload?.request;
  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog open={open} onClose={close} title={payload?.title ?? 'Share'}>
        {payload && (
          <>
            {r && r.status === 'SENT' && r.sentAt && r.expiresAt && (
              <div className="pd-sharehead">
                <CountdownRing sentAt={r.sentAt} expiresAt={r.expiresAt} />
                <p>Pay exactly <strong>{formatNaira(r.amountKobo)}</strong>. This account is for this payment only.</p>
              </div>
            )}
            <p className="pd-label" id="pd-msg-label">The message, exactly as it will be sent</p>
            <div className="pd-msg" role="textbox" aria-readonly="true" aria-labelledby="pd-msg-label" tabIndex={0}>
              {payload.message.text}
            </div>
            <div className="pd-actions pd-actions--stack">
              <Button icon="send" block onClick={() => go(payload.message.whatsappUrl)}>Open WhatsApp</Button>
              <div className="pd-actions">
                <Button variant="line" onClick={() => go(payload.message.telegramUrl)}>Telegram</Button>
                <Button variant="line" onClick={() => void copy()}>Copy message</Button>
                <Button variant="quiet" onClick={close}>Done</Button>
              </div>
            </div>
          </>
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

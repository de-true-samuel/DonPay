import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { cls } from '../lib/cls';

type Tone = 'ok' | 'bad' | 'info';
interface Toast { id: number; text: string; tone: Tone }
interface ToastApi { success: (t: string) => void; error: (t: string) => void; info: (t: string) => void }

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone) => {
    const id = ++seq;
    setItems((l) => [...l.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), tone === 'bad' ? 7000 : 4000);
  }, []);
  const api = useMemo<ToastApi>(() => ({
    success: (t) => push(t, 'ok'), error: (t) => push(t, 'bad'), info: (t) => push(t, 'info'),
  }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pd-toasts" aria-live="polite">
        {items.map((t) => <p key={t.id} className={cls('pd-toast', `pd-toast--${t.tone}`)}>{t.text}</p>)}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Native <dialog>: focus trap, Escape and backdrop come from the browser. Bottom sheet on phones. */
export function Dialog({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="pd-dialog" aria-labelledby={titleId} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="pd-dialog__in">
          <header className="pd-dialog__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="pd-iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" size={20} /></button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

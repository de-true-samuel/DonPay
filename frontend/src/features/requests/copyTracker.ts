import { useEffect, useState } from 'react';

const key = (id: string) => `paidar.copied.${id}`;

export function getCopiedAt(requestId: string): string | null {
  try {
    return localStorage.getItem(key(requestId));
  } catch {
    return null;
  }
}

export function markCopied(requestId: string): void {
  try {
    localStorage.setItem(key(requestId), new Date().toISOString());
    window.dispatchEvent(new CustomEvent('paidar:copied', { detail: { requestId } }));
  } catch {
    /* storage unavailable */
  }
}

export function useCopiedAt(requestId?: string): string | null {
  const [at, setAt] = useState<string | null>(() => (requestId ? getCopiedAt(requestId) : null));

  useEffect(() => {
    if (!requestId) return;
    setAt(getCopiedAt(requestId));

    const onCopied = (e: Event) => {
      const ce = e as CustomEvent<{ requestId: string }>;
      if (ce.detail?.requestId === requestId) {
        setAt(getCopiedAt(requestId));
      }
    };
    window.addEventListener('paidar:copied', onCopied);
    return () => window.removeEventListener('paidar:copied', onCopied);
  }, [requestId]);

  return at;
}

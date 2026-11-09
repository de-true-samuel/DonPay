import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'paidar.theme';
const COLORS = { light: '#F6F4FB', dark: '#0F0A1E' } as const;

export const resolveTheme = (pref: ThemePref, systemDark: boolean): 'light' | 'dark' =>
  pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

function apply(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
  const dark = resolveTheme(pref, window.matchMedia('(prefers-color-scheme: dark)').matches) === 'dark';
  document.getElementById('pd-theme-color')?.setAttribute('content', dark ? COLORS.dark : COLORS.light);
}

/** Match the device by default; the person can force light or dark in Settings. */
export function useTheme(): { pref: ThemePref; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  useEffect(() => {
    apply(pref);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply(pref);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);
  const setPref = useCallback((p: ThemePref) => {
    try { if (p === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* storage unavailable */ }
    setPrefState(p);
  }, []);
  return { pref, setPref };
}

/** Run once at start so the right theme and browser colour apply before anything is signed in. */
export const initTheme = (): void => apply(readPref());

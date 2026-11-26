import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'obsidian' | 'daylight' | 'system';
export type ResolvedTheme = 'obsidian' | 'daylight';
export type FxPref = 'auto' | 'full' | 'lite' | 'min';
export type ResolvedFx = 'full' | 'lite' | 'min';

const THEME_KEY = 'paidar.theme.v2';
const FX_KEY = 'paidar.fx';
const THEME_COLORS: Record<ResolvedTheme, string> = {
  obsidian: '#090B11',
  daylight: '#F2F4F9',
};

export function normalizeThemePref(raw: string | null | undefined): ThemePref {
  if (raw === 'daylight' || raw === 'light') return 'daylight';
  if (raw === 'system') return 'system';
  return 'obsidian';
}

export function resolveTheme(pref: ThemePref, systemLight: boolean): ResolvedTheme {
  if (pref === 'system') return systemLight ? 'daylight' : 'obsidian';
  return pref;
}

export function readThemePref(): ThemePref {
  try {
    return normalizeThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return 'obsidian';
  }
}

export interface FxCapabilities {
  reducedMotion: boolean;
  saveData: boolean;
  deviceMemory?: number | null;
  hardwareConcurrency?: number | null;
}

export function resolveFxTier(pref: FxPref, caps: FxCapabilities): ResolvedFx {
  if (pref === 'full' || pref === 'lite' || pref === 'min') return pref;
  if (caps.reducedMotion || caps.saveData) return 'min';
  const mem = typeof caps.deviceMemory === 'number' ? caps.deviceMemory : null;
  const cores = typeof caps.hardwareConcurrency === 'number' ? caps.hardwareConcurrency : null;
  if ((mem !== null && mem <= 2) || (cores !== null && cores <= 4)) return 'lite';
  if (mem === null && cores === null) return 'lite';
  return 'full';
}

export function readFxPref(): FxPref {
  try {
    const v = localStorage.getItem(FX_KEY);
    return v === 'full' || v === 'lite' || v === 'min' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function getCaps(): FxCapabilities {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return {
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: !!nav.connection?.saveData,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
  };
}

function applyTheme(pref: ThemePref): void {
  const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const resolved = resolveTheme(pref, systemLight);
  document.documentElement.setAttribute('data-theme', resolved);
  document.getElementById('pd-theme-color')?.setAttribute('content', THEME_COLORS[resolved]);
}

function applyFx(pref: FxPref): void {
  const resolved = resolveFxTier(pref, getCaps());
  document.documentElement.setAttribute('data-fx', resolved);
}

/** Provider theme preference: defaults to Obsidian, supports Daylight and System. */
export function useTheme(): {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
} {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref);
  const [systemLight, setSystemLight] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)').matches : false,
  );

  useEffect(() => {
    applyTheme(pref);
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => {
      setSystemLight(mq.matches);
      applyTheme(pref);
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      /* storage unavailable */
    }
    applyTheme(p);
    setPrefState(p);
  }, []);

  return { pref, resolved: resolveTheme(pref, systemLight), setPref };
}

/** Visual effects performance tier preference: Auto, Full, Lite, or Minimal. */
export function useFxTier(): {
  fxPref: FxPref;
  resolvedFx: ResolvedFx;
  setFxPref: (p: FxPref) => void;
} {
  const [fxPref, setFxPrefState] = useState<FxPref>(readFxPref);
  const [resolvedFx, setResolvedFx] = useState<ResolvedFx>(() =>
    typeof window !== 'undefined' ? resolveFxTier(readFxPref(), getCaps()) : 'lite',
  );

  useEffect(() => {
    const sync = () => {
      applyFx(fxPref);
      setResolvedFx(resolveFxTier(fxPref, getCaps()));
    };
    sync();
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [fxPref]);

  const setFxPref = useCallback((p: FxPref) => {
    try {
      localStorage.setItem(FX_KEY, p);
    } catch {
      /* storage unavailable */
    }
    applyFx(p);
    setResolvedFx(resolveFxTier(p, getCaps()));
    setFxPrefState(p);
  }, []);

  return { fxPref, resolvedFx, setFxPref };
}

/** Spotlight pointer tracker: only active on fine pointer + data-fx='full'. */
export function useSpotlightController(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fine = window.matchMedia('(pointer: fine)');
    let raf = 0;
    let lastTarget: HTMLElement | null = null;
    let clientX = 0;
    let clientY = 0;

    const flush = () => {
      raf = 0;
      if (!lastTarget) return;
      const tile = lastTarget.closest('.ob-tile, .pf-card, .pf-metric') as HTMLElement | null;
      if (!tile) return;
      const r = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${Math.round(clientX - r.left)}px`);
      tile.style.setProperty('--my', `${Math.round(clientY - r.top)}px`);
    };

    const onMove = (e: PointerEvent) => {
      if (!fine.matches) return;
      if (document.documentElement.getAttribute('data-fx') !== 'full') return;
      if (e.pointerType !== 'mouse') return;
      lastTarget = e.target as HTMLElement | null;
      clientX = e.clientX;
      clientY = e.clientY;
      if (!raf) raf = window.requestAnimationFrame(flush);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);
}

export const initTheme = (): void => {
  applyTheme(readThemePref());
  applyFx(readFxPref());
};

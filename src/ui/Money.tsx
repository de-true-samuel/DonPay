import { useEffect, useRef, useState } from 'react';
import { cls } from '../lib/cls';
import { formatNaira, splitNaira, toBig } from '../lib/money';

/**
 * Dedicated Obsidian Signal Money component (§3.6 & §4.7).
 * Enforces superscript currency, tabular JetBrains Mono figures, odometer animation on change,
 * negative Flare sign (U+2212), zero Ink-3 styling, and plain integer clipboard semantics.
 */
export function Money({
  kobo,
  size = 'md',
  tone,
  animate = false,
  className,
}: {
  kobo: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'default' | 'mint' | 'solar' | 'flare';
  animate?: boolean;
  className?: string;
}) {
  const val = toBig(kobo);
  const isZero = val === 0n;
  const isNeg = val < 0n;
  const { whole, frac } = splitNaira(kobo);
  const showDecimals = size !== 'sm' || frac !== '00';
  const plainLabel = formatNaira(kobo, size === 'sm' ? 'auto' : 'always');

  const [displayKobo, setDisplayKobo] = useState(kobo);
  const [rolling, setRolling] = useState(false);
  const prevValRef = useRef<bigint>(val);
  const mountedRef = useRef(false);

  useEffect(() => {
    const fx = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-fx') : 'lite';
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prev = prevValRef.current;

    if (!animate || reduced || fx === 'min') {
      prevValRef.current = val;
      setDisplayKobo(kobo);
      return;
    }

    const fromVal = !mountedRef.current ? 0n : prev;
    mountedRef.current = true;
    prevValRef.current = val;

    if (fromVal === val) {
      setDisplayKobo(kobo);
      return;
    }

    if (fx === 'lite') {
      setRolling(true);
      setDisplayKobo(kobo);
      const t = window.setTimeout(() => setRolling(false), 300);
      return () => window.clearTimeout(t);
    }

    // Smooth 800ms ease-out odometer interpolation on full tier
    let raf = 0;
    const startTime = performance.now();
    const dur = prev === val ? 800 : 640;
    const diff = val - fromVal;

    const step = (now: number) => {
      const p = Math.min(1, (now - startTime) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = fromVal + BigInt(Math.round(Number(diff) * eased));
      setDisplayKobo(cur.toString());
      if (p < 1) {
        raf = window.requestAnimationFrame(step);
      } else {
        setDisplayKobo(kobo);
      }
    };
    setRolling(true);
    raf = window.requestAnimationFrame(step);
    const done = window.setTimeout(() => setRolling(false), dur);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [kobo, val, animate]);

  const d = splitNaira(animate ? displayKobo : kobo);
  const effectiveWhole = animate ? d.whole : whole;
  const effectiveFrac = animate ? d.frac : frac;
  const toneClass = isNeg ? 'ob-money--flare' : isZero ? 'ob-money--zero' : tone ? `ob-money--${tone}` : undefined;

  return (
    <span
      className={cls('ob-money', 'pd-money', `pd-money--${size}`, `ob-money--${size}`, toneClass, rolling && 'is-rolling', className)}
      aria-label={plainLabel}
    >
      <span className="pd-sr-only">{plainLabel}</span>
      <span aria-hidden="true" className="ob-money__vis">
        {isNeg && <span className="ob-money__sign">{'−'}</span>}
        <span className="ob-money__cur pd-money__cur">₦</span>
        <span className="ob-money__int">{effectiveWhole}</span>
        {showDecimals && <span className="ob-money__dec pd-money__frac">.{effectiveFrac}</span>}
      </span>
    </span>
  );
}

import { useId } from 'react';

/**
 * Paidar radar brand mark (§3.11):
 * Concentric radar geometry. 2px ring strokes in --ink-1 (or white on always-dark panels),
 * centre node filled with --grad-volt and a subtle 40% Volt glow.
 */
export function LogoMark({ size = 28, tone }: { size?: number; tone?: 'light' | 'dark' }) {
  const uid = useId().replace(/:/g, '');
  const ringStroke = tone === 'dark' ? '#F4F6FB' : tone === 'light' ? '#0B0F1A' : 'var(--ink-1)';
  const voltGradId = `ob-volt-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="ob-logomark"
      style={{ flexShrink: 0, filter: 'drop-shadow(0 0 8px rgba(200, 255, 61, 0.25))' }}
    >
      <defs>
        <linearGradient id={voltGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E6FF6B" />
          <stop offset="45%" stopColor="#C8FF3D" />
          <stop offset="100%" stopColor="#8EF05A" />
        </linearGradient>
      </defs>
      {/* Concentric outer signal arc + inner radar ring forming the Paidar 'P' silhouette */}
      <circle cx="16" cy="15" r="11" stroke={ringStroke} strokeWidth="2" strokeOpacity="0.28" />
      <path
        d="M9 26.5V8.5C9 7.67157 9.67157 7 10.5 7H17.5C21.366 7 24.5 10.134 24.5 14C24.5 17.866 21.366 21 17.5 21H12.5"
        stroke={ringStroke}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Central verified-signal Volt node */}
      <circle cx="17.2" cy="14" r="3.4" fill={`url(#${voltGradId})`} />
    </svg>
  );
}

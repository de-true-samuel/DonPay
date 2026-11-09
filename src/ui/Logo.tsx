/** Radar-ping mark. tone="dark" is for dark backgrounds. */
export function LogoMark({ size = 40, tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  const dot = tone === 'dark' ? '#F5F2FF' : '#140B2B';
  const sweep = tone === 'dark' ? '#C9B8FF' : '#6D28D9';
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="pd-sw" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C3AED" stopOpacity="0.15" />
          <stop offset="1" stopColor="#7C3AED" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <circle cx="80" cy="80" r="70" fill="none" stroke="#7C3AED" strokeOpacity="0.35" strokeWidth="5" />
      <circle cx="80" cy="80" r="50" fill="none" stroke="#7C3AED" strokeOpacity="0.6" strokeWidth="5" />
      <circle cx="80" cy="80" r="30" fill="none" stroke="#7C3AED" strokeOpacity="0.9" strokeWidth="5" />
      <path d="M80 80 L80 10 A70 70 0 0 1 140.6 45 Z" fill="url(#pd-sw)" />
      <line x1="80" y1="80" x2="80" y2="10" stroke={sweep} strokeWidth="5" strokeLinecap="round" />
      <circle cx="102.5" cy="41" r="13" fill="#2EE6A6" fillOpacity="0.25" />
      <circle cx="102.5" cy="41" r="7" fill="#2EE6A6" />
      <circle cx="80" cy="80" r="6" fill={dot} />
    </svg>
  );
}

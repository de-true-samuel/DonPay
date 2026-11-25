/**
 * Paidar brand mark (Spec §2.2):
 * Compact geometric "P" built from two connected points suggesting an incoming
 * payment moving into an actionable work state. Recognizable at 20px and 32px.
 */
export function LogoMark({ size = 28, tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  const primary = tone === 'dark' ? '#FFFFFF' : '#111B33';
  const accent = tone === 'dark' ? '#8192FF' : '#5368F8';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Continuous geometric stem + top bar into payment node */}
      <path
        d="M8 26V7.5C8 6.67157 8.67157 6 9.5 6H18.5C22.6421 6 26 9.35786 26 13.5C26 17.6421 22.6421 21 18.5 21H12.5"
        stroke={primary}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Verified payment-to-work dot */}
      <circle cx="17.5" cy="13.5" r="3" fill={accent} />
    </svg>
  );
}

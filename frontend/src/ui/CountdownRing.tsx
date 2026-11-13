import { cls } from '../lib/cls';
import { useNow } from '../lib/hooks';
import { formatCountdown } from '../lib/time';

const R = 24;
const C = 2 * Math.PI * R;

export interface CountdownRingProps {
  sentAt: string;
  expiresAt: string;
  size?: 'sm' | 'md' | 'hero';
  className?: string;
}

/** A shrinking ring with a radar sweep. Amber under 30 minutes, red when expired. */
export function CountdownRing({
  sentAt,
  expiresAt,
  size = 'sm',
  className,
}: CountdownRingProps) {
  const now = useNow(1000);
  const end = new Date(expiresAt).getTime();
  const start = new Date(sentAt).getTime();
  const left = end - now;
  const frac = Math.min(1, Math.max(0, left / Math.max(1, end - start)));
  const state = left <= 0 ? 'bad' : left < 30 * 60_000 ? 'wait' : 'ok';

  return (
    <div
      className={cls('pd-ring', `pd-ring--${size}`, `pd-ring--${state}`, className)}
      role="timer"
      aria-label={left <= 0 ? 'Expired' : `${formatCountdown(left)} left`}
    >
      <svg
        viewBox="0 0 56 56"
        aria-hidden="true"
        className="pd-ring__svg"
      >
        <circle cx="28" cy="28" r={R} className="pd-ring__track" />
        <circle
          cx="28"
          cy="28"
          r={R}
          className="pd-ring__bar"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          transform="rotate(-90 28 28)"
        />
        {state !== 'bad' && (
          <g className="pd-ring__sweep">
            <line x1="28" y1="28" x2="28" y2="10" />
          </g>
        )}
      </svg>
      <span className="pd-ring__time">{left <= 0 ? 'Ended' : formatCountdown(left)}</span>
    </div>
  );
}

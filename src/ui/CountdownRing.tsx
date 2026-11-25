import { useMemo } from 'react';
import { cls } from '../lib/cls';
import { useNow } from '../lib/hooks';
import { formatCountdown } from '../lib/time';

const VIEW_SIZE = 100;
const CX = 50;
const CY = 50;
const R = 38;
const C = 2 * Math.PI * R;

export interface CountdownRingProps {
  sentAt: string;
  expiresAt: string;
  size?: 'sm' | 'md' | 'hero';
  caption?: string;
  className?: string;
}

/**
 * Obsidian Chrono Ring (§4.6):
 * 60-tick watch bezel SVG with clockwise draining arc starting at 12 o'clock,
 * glowing head node in Solar (active) or Flare (urgent/expired), and tabular JetBrains Mono readout.
 */
export function CountdownRing({
  sentAt,
  expiresAt,
  size = 'sm',
  caption,
  className,
}: CountdownRingProps) {
  const now = useNow(1000);
  const end = new Date(expiresAt).getTime();
  const start = new Date(sentAt).getTime();
  const left = end - now;
  const frac = Math.min(1, Math.max(0, left / Math.max(1, end - start)));

  // Preserve existing state logic: Solar default, Flare if expired/urgent (<10m)
  const state = left <= 0 ? 'bad' : left <= 10 * 60_000 ? 'bad' : 'wait';
  const expired = left <= 0;

  // 60 evenly spaced tick marks around the watch bezel
  const ticks = useMemo(
    () =>
      Array.from({ length: 60 }, (_, idx) => {
        const angle = (idx / 60) * Math.PI * 2 - Math.PI / 2;
        const isMajor = idx % 5 === 0;
        const rInner = isMajor ? 42 : 44;
        const rOuter = 47;
        return {
          idx,
          major: isMajor,
          x1: CX + Math.cos(angle) * rInner,
          y1: CY + Math.sin(angle) * rInner,
          x2: CX + Math.cos(angle) * rOuter,
          y2: CY + Math.sin(angle) * rOuter,
        };
      }),
    [],
  );

  // Head coordinates along the clockwise draining arc starting at 12 o'clock (-90deg)
  const headAngle = -Math.PI / 2 + (1 - frac) * Math.PI * 2;
  const headX = CX + Math.cos(headAngle) * R;
  const headY = CY + Math.sin(headAngle) * R;

  return (
    <div
      className={cls('ob-chrono', 'pd-ring', `pd-ring--${size}`, `pd-ring--${state}`, expired && 'is-expired', className)}
      role="timer"
      aria-label={expired ? 'Expired' : `${formatCountdown(left)} left on this dynamic account`}
    >
      <div className="ob-chrono__dial">
        <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} aria-hidden="true" className="pd-ring__svg">
          {/* 60-tick bezel */}
          <g className="ob-chrono__ticks">
            {ticks.map((t) => (
              <line
                key={t.idx}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                className={t.major ? 'is-major' : undefined}
              />
            ))}
          </g>

          {/* Subdued track */}
          <circle cx={CX} cy={CY} r={R} className="pd-ring__track" />

          {/* Clockwise draining progress arc starting at 12 o'clock */}
          {!expired && (
            <circle
              cx={CX}
              cy={CY}
              r={R}
              className="ob-chrono__progress pd-ring__bar"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          )}

          {/* Glowing head marker */}
          {!expired && (
            <g className="ob-chrono__head">
              <circle cx={headX} cy={headY} r={size === 'hero' ? 4.2 : 3.2} className="ob-chrono__head-glow" />
              <circle cx={headX} cy={headY} r={size === 'hero' ? 2.4 : 2} className="ob-chrono__head-core" />
            </g>
          )}
        </svg>

        <div className="pd-ring__time">
          <span>{expired ? '00:00' : formatCountdown(left)}</span>
          {size === 'hero' && (
            <span className="ob-chrono__sub">
              {expired ? 'Expired' : caption || 'left on this dynamic account'}
            </span>
          )}
        </div>
      </div>
      {size !== 'hero' && caption && <span className="ob-chrono__caption">{caption}</span>}
    </div>
  );
}

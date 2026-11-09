import type { ReactNode } from 'react';

export type IconName =
  | 'today' | 'jobs' | 'people' | 'search' | 'plus' | 'check' | 'pencil'
  | 'flask' | 'clock' | 'x' | 'send' | 'chevron' | 'gear' | 'alert';

const PATHS: Record<IconName, ReactNode> = {
  today: <><circle cx="12" cy="12" r="9" /><path d="M12 12 L18 7" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  jobs: <path d="M5 7h14M5 12h14M5 17h9" />,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3.2 2.5-5 5.5-5s5.5 1.8 5.5 5" /><path d="M16 5.5a3 3 0 010 5.8M18.5 19c0-2.2-1-3.7-2.5-4.5" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pencil: <path d="M5 19l1-4 9.5-9.5 3 3L9 18z" />,
  flask: <path d="M9 4h6M10 4v6l-5 9h14l-5-9V4" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  send: <path d="M20 4L4 11l5 2 2 6 3-4 5 3z" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

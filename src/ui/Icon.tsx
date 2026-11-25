import {
  AlertTriangle,
  Ban,
  Bell,
  Briefcase,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  FlaskConical,
  Info,
  LayoutDashboard,
  ListOrdered,
  Loader,
  Lock,
  LogOut,
  MinusCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Users,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cls } from '../lib/cls';

export type IconName =
  | 'today'
  | 'dashboard'
  | 'queue'
  | 'jobs'
  | 'payments'
  | 'people'
  | 'notifications'
  | 'search'
  | 'plus'
  | 'check'
  | 'pencil'
  | 'flask'
  | 'clock'
  | 'x'
  | 'x-circle'
  | 'minus-circle'
  | 'send'
  | 'chevron'
  | 'gear'
  | 'alert'
  | 'signout'
  | 'more'
  | 'collapse'
  | 'expand'
  | 'lock'
  | 'copy'
  | 'external'
  | 'refresh'
  | 'shield'
  | 'info'
  | 'pause'
  | 'ban'
  | 'refund'
  | 'undo'
  | 'calendar'
  | 'radar'
  | 'zap'
  | 'loader';

const ICONS: Record<IconName, LucideIcon> = {
  today: LayoutDashboard,
  dashboard: LayoutDashboard,
  queue: ListOrdered,
  jobs: Briefcase,
  payments: CreditCard,
  people: Users,
  notifications: Bell,
  search: Search,
  plus: Plus,
  check: Check,
  pencil: Pencil,
  flask: FlaskConical,
  clock: Clock,
  x: X,
  'x-circle': XCircle,
  'minus-circle': MinusCircle,
  send: Send,
  chevron: ChevronRight,
  gear: Settings,
  alert: AlertTriangle,
  signout: LogOut,
  more: MoreHorizontal,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  lock: Lock,
  copy: Copy,
  external: ExternalLink,
  refresh: RefreshCw,
  shield: ShieldCheck,
  info: Info,
  pause: Pause,
  ban: Ban,
  refund: RotateCcw,
  undo: RotateCcw,
  calendar: Calendar,
  radar: Radio,
  zap: Zap,
  loader: Loader,
};

/** Single Lucide icon set at 1.5px stroke (1.25px for illustrative 32px+ sizes) per §3.11. */
export function Icon({
  name,
  size = 20,
  glow,
  pulse,
  className,
}: {
  name: IconName;
  size?: number;
  glow?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  const Cmp = ICONS[name];
  const stroke = size >= 32 ? 1.25 : 1.5;
  return (
    <Cmp
      size={size}
      strokeWidth={stroke}
      aria-hidden="true"
      focusable="false"
      className={cls('ob-icon', glow && 'ob-icon--active', pulse && 'ob-icon--pulse', className)}
    />
  );
}

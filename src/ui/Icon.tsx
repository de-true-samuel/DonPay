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
  Lock,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

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
  | 'calendar';

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
  calendar: Calendar,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const Cmp = ICONS[name];
  return <Cmp size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}

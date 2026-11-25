import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { todayApi } from '../api/endpoints';
import { PaidPingLayer } from '../features/ping/PaidPing';
import { ShareProvider } from '../features/share/ShareProvider';
import { cls } from '../lib/cls';
import { Icon, type IconName } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';
import { Skeleton } from '../ui/primitives';
import { ToastProvider } from '../ui/Toast';
import { AccountMenu } from './AccountMenu';
import { ConnectionBanner, RiskBanner, UpdateBanner } from './Banners';

const SIDEBAR_KEY = 'paidar.sidebar.collapsed';

function RouteFallback() {
  return (
    <div className="pd-stack" aria-busy="true" aria-label="Loading">
      <Skeleton h={34} w="40%" />
      <Skeleton h={120} />
      <Skeleton h={120} />
    </div>
  );
}

function pageTitleFor(pathname: string): string {
  if (pathname === '/app' || pathname === '/today') return 'Dashboard';
  if (pathname.startsWith('/app/queue')) return 'Next up';
  if (pathname.startsWith('/app/new') || pathname.startsWith('/new')) return 'New payment request';
  if (pathname.startsWith('/app/jobs') || pathname.startsWith('/jobs')) return 'Jobs';
  if (pathname.startsWith('/app/payments') || pathname.startsWith('/review')) return 'Payments';
  if (pathname.startsWith('/app/clients') || pathname.startsWith('/people')) return 'Clients';
  if (pathname.startsWith('/app/notifications')) return 'Notifications';
  if (pathname.startsWith('/app/settings') || pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/search')) return 'Search';
  return 'Paidar';
}

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  badge?: number;
  badgeDanger?: boolean;
}

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { provider, signOut } = useAuth();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);

  const { data: today } = useQuery({
    queryKey: ['today'],
    queryFn: () => todayApi.get(),
    staleTime: 15_000,
  });
  const attentionCount = today?.counts.needsReview ?? 0;

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    setMoreOpen(false);
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  const navItems: NavItem[] = [
    { to: '/app', label: 'Dashboard', icon: 'dashboard', end: true },
    { to: '/app/queue', label: 'Queue', icon: 'queue' },
    { to: '/app/jobs', label: 'Jobs', icon: 'jobs' },
    { to: '/app/payments', label: 'Payments', icon: 'payments', badge: attentionCount, badgeDanger: attentionCount > 0 },
    { to: '/app/clients', label: 'Clients', icon: 'people' },
    { to: '/app/notifications', label: 'Notifications', icon: 'notifications' },
    { to: '/app/settings', label: 'Settings', icon: 'gear' },
  ];

  const pageTitle = pageTitleFor(pathname);

  return (
    <ToastProvider>
      <ShareProvider>
        <div className={cls('pf-shell', collapsed && 'is-collapsed')}>
          <a href="#main" className="pd-skip">Skip to content</a>
          <PaidPingLayer />

          {/* Desktop Sidebar (>=1024px, Midnight Navy) */}
          <aside className={cls('pf-sidebar', collapsed && 'is-collapsed')} aria-label="Sidebar navigation">
            <Link to="/app" className="pf-sidebar__brand" aria-label="Paidar, go to Dashboard">
              <LogoMark size={26} />
              {!collapsed && <span>paidar</span>}
            </Link>

            {provider && (
              <Link to="/app/settings" className="pf-sidebar__biz" title={provider.businessName}>
                {provider.businessName}
              </Link>
            )}

            <nav className="pf-sidebar__nav">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  aria-label={item.label}
                  className={({ isActive }) => cls('pf-nav-item', isActive && 'is-active')}
                >
                  <Icon name={item.icon} size={20} />
                  <span className="pf-nav-item__label">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={cls('pf-nav-badge', item.badgeDanger && 'pf-nav-badge--danger')}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="pf-sidebar__foot">
              <button
                type="button"
                className="pf-collapse-btn"
                onClick={toggleCollapsed}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <Icon name={collapsed ? 'expand' : 'collapse'} size={18} />
                {!collapsed && <span>Collapse</span>}
              </button>
            </div>
          </aside>

          {/* Main Workspace */}
          <div className="pf-workspace">
            <header className="pf-header" aria-label="Top header">
              <div className="pf-header__left">
                <Link to="/app" className="pf-header__mobile-brand" aria-label="Paidar home">
                  <LogoMark size={24} />
                  <span>paidar</span>
                </Link>
                <span className="pf-header__title">{pageTitle}</span>
              </div>

              <div className="pf-header__right">
                <button
                  type="button"
                  className="pf-test-pill"
                  onClick={() => setTestModalOpen(true)}
                  title="Test mode. No real money moves. Payments are simulated."
                  data-flow-id="GLB-04"
                >
                  <Icon name="flask" size={14} />
                  <span>Test mode</span>
                </button>

                <Link to="/app/new" className="pf-header-cta" data-flow-id="DSH-02">
                  <Icon name="plus" size={16} />
                  <span>New request</span>
                </Link>

                <Link
                  to="/app/notifications"
                  className="pf-icon-btn"
                  aria-label="Notifications"
                  title="Notifications"
                  data-flow-id="GLB-05"
                >
                  <Icon name="notifications" size={20} />
                </Link>

                <AccountMenu />
              </div>
            </header>

            <RiskBanner />
            <ConnectionBanner />
            <UpdateBanner />

            <main id="main" ref={mainRef} tabIndex={-1} className="pf-main">
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
            </main>
          </div>

          {/* Mobile / Tablet Bottom Navigation (<1024px) */}
          <nav className="pf-tabbar" aria-label="Mobile navigation" data-flow-id="GLB-02">
            <NavLink to="/app" end className={({ isActive }) => cls('pf-tab', isActive && 'is-active')}>
              <Icon name="dashboard" size={20} />
              <span>Home</span>
            </NavLink>

            <NavLink to="/app/queue" className={({ isActive }) => cls('pf-tab', isActive && 'is-active')}>
              <Icon name="queue" size={20} />
              <span>Queue</span>
            </NavLink>

            <div className="pf-tab-new">
              <Link to="/app/new" className="pf-tab-new__btn" aria-label="New payment request">
                <Icon name="plus" size={22} />
              </Link>
            </div>

            <NavLink to="/app/payments" className={({ isActive }) => cls('pf-tab', isActive && 'is-active')}>
              <Icon name="payments" size={20} />
              <span>Payments</span>
            </NavLink>

            <button
              type="button"
              className={cls('pf-tab', moreOpen && 'is-active')}
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
            >
              <Icon name="more" size={20} />
              <span>More</span>
            </button>
          </nav>

          {/* Mobile "More" Bottom Sheet */}
          {moreOpen && (
            <div className="pf-sheet-backdrop" onClick={() => setMoreOpen(false)}>
              <div className="pf-sheet" role="dialog" aria-label="More navigation" onClick={(e) => e.stopPropagation()}>
                <Link to="/app/jobs" className="pf-sheet__item" onClick={() => setMoreOpen(false)}>
                  <Icon name="jobs" size={20} />
                  <span>Jobs</span>
                </Link>
                <Link to="/app/clients" className="pf-sheet__item" onClick={() => setMoreOpen(false)}>
                  <Icon name="people" size={20} />
                  <span>Clients</span>
                </Link>
                <Link to="/app/notifications" className="pf-sheet__item" onClick={() => setMoreOpen(false)}>
                  <Icon name="notifications" size={20} />
                  <span>Notifications</span>
                </Link>
                <Link to="/app/settings" className="pf-sheet__item" onClick={() => setMoreOpen(false)}>
                  <Icon name="gear" size={20} />
                  <span>Settings</span>
                </Link>
                <button
                  type="button"
                  className="pf-sheet__item pf-sheet__item--danger"
                  onClick={() => { setMoreOpen(false); void signOut().then(() => navigate('/auth')); }}
                >
                  <Icon name="signout" size={20} />
                  <span>Log out</span>
                </button>
              </div>
            </div>
          )}

          {/* Test-mode explainer modal (GLB-04) */}
          {testModalOpen && (
            <div className="pf-sheet-backdrop" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setTestModalOpen(false)}>
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Test mode information"
                style={{ background: '#FFFFFF', borderRadius: 14, padding: 24, maxWidth: 420, width: '100%', border: '1px solid var(--border-default)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <h2 style={{ marginBottom: 8 }}>Test mode is active</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                  No real money moves in test mode. Virtual accounts and payment verifications are simulated in sandbox so you can test the full payment-to-work flow safely.
                </p>
                <button
                  type="button"
                  onClick={() => setTestModalOpen(false)}
                  style={{
                    height: 44, padding: '0 18px', borderRadius: 9, border: 0,
                    background: 'var(--action-primary)', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Got it
                </button>
              </div>
            </div>
          )}
        </div>
      </ShareProvider>
    </ToastProvider>
  );
}

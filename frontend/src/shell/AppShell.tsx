import { Suspense, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { PaidPingLayer } from '../features/ping/PaidPing';
import { ShareProvider } from '../features/share/ShareProvider';
import { cls } from '../lib/cls';
import { Icon } from '../ui/Icon';
import { LogoMark } from '../ui/Logo';
import { Skeleton } from '../ui/primitives';
import { ToastProvider } from '../ui/Toast';
import { ConnectionBanner, RiskBanner, UpdateBanner } from './Banners';

const TABS = [
  { to: '/today', label: 'Today', icon: 'today' },
  { to: '/jobs', label: 'Jobs', icon: 'jobs' },
  { to: '/people', label: 'People', icon: 'people' },
  { to: '/search', label: 'Search', icon: 'search' },
] as const;

function RouteFallback() {
  return <div className="pd-stack" aria-busy="true" aria-label="Loading"><Skeleton h={34} w="50%" /><Skeleton h={120} /><Skeleton h={120} /></div>;
}

export function AppShell() {
  const { provider } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  const wide = /^\/(today|jobs|people)(\/|$)/.test(pathname);
  const initial = (provider?.businessName ?? '?').trim().charAt(0).toUpperCase();

  // New screen: start at the top and move focus into the page, so keyboard and screen-reader users aren't left behind.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <ToastProvider>
      <ShareProvider>
        <div className="pd-app">
          <a href="#main" className="pd-skip">Skip to content</a>
          <PaidPingLayer />

          <header className="pd-header">
            <Link to="/today" className="pd-brand" aria-label="Paidar, go to Today"><LogoMark size={28} /><span>paidar</span></Link>
            <NavLink to="/settings" className="pd-avatar" aria-label="Settings">{initial}</NavLink>
          </header>

          <nav className="pd-tabbar" aria-label="Main">
            <div className="pd-tabbar__in">
              <Link to="/today" className="pd-rail__brand" aria-label="Paidar, go to Today"><LogoMark size={32} /><span>paidar</span></Link>
              <Link to="/new" className="pd-rail__new"><Icon name="plus" size={20} /><span>New request</span></Link>
              {TABS.map((t) => (
                <NavLink key={t.to} to={t.to} className={({ isActive }) => cls('pd-tab', isActive && 'is-active')}>
                  <Icon name={t.icon} size={22} /><span>{t.label}</span>
                </NavLink>
              ))}
              <NavLink to="/settings" className={({ isActive }) => cls('pd-rail__me', isActive && 'is-active')}>
                <span className="pd-avatar" aria-hidden="true">{initial}</span>
                <span className="pd-rail__name">{provider?.businessName}</span>
              </NavLink>
            </div>
          </nav>

          <div className="pd-stage">
            <RiskBanner />
            <ConnectionBanner />
            <UpdateBanner />
            <main id="main" ref={mainRef} tabIndex={-1} className={cls('pd-main', wide && 'pd-main--wide')}>
              <Suspense fallback={<RouteFallback />}><Outlet /></Suspense>
            </main>
          </div>

          {pathname !== '/new' && (
            <Link to="/new" className="pd-fab"><Icon name="plus" size={20} /><span>New request</span></Link>
          )}
        </div>
      </ShareProvider>
    </ToastProvider>
  );
}

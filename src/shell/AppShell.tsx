import { Suspense, useEffect, useRef, useState } from 'react';
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

function RouteFallback() {
  return (
    <div className="pd-stack" aria-busy="true" aria-label="Loading">
      <Skeleton h={34} w="50%" />
      <Skeleton h={140} />
      <Skeleton h={140} />
    </div>
  );
}

export function AppShell() {
  const { provider } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  const wide = /^\/(today|jobs|people|review)(\/|$)/.test(pathname);
  const initial = (provider?.businessName ?? '?').trim().charAt(0).toUpperCase();

  // Scroll listener for auto-hiding top bar on scroll down, showing on scroll up
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > 60 && currentScrollY > lastScrollY.current + 5) {
        setHeaderVisible(false);
      } else if (currentScrollY < lastScrollY.current - 5) {
        setHeaderVisible(true);
      }
      lastScrollY.current = currentScrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // New screen: scroll to top and set focus
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <ToastProvider>
      <ShareProvider>
        <div className="pd-app">
          <a href="#main" className="pd-skip">
            Skip to content
          </a>
          <PaidPingLayer />

          {/* Top Bar — Transparent over ground, hides on scroll down (Spec 5.3) */}
          <header
            className={cls('pd-header', !headerVisible && 'is-hidden')}
            aria-label="Top navigation"
          >
            <Link to="/today" className="pd-brand" aria-label="Paidar, go to Today">
              <LogoMark size={28} />
              <span>paidar</span>
            </Link>
            <NavLink to="/settings" className="pd-avatar" aria-label="Settings">
              {initial}
            </NavLink>
          </header>

          <div className="pd-stage">
            <RiskBanner />
            <ConnectionBanner />
            <UpdateBanner />
            <main
              id="main"
              ref={mainRef}
              tabIndex={-1}
              className={cls('pd-main', wide && 'pd-main--wide')}
            >
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
            </main>
          </div>

          {/* Floating Pill Dock (Spec 5.3 & 6) */}
          <nav className="pd-dock" aria-label="Main Navigation">
            <div className="pd-dock__in">
              <NavLink
                to="/today"
                className={({ isActive }) => cls('pd-dock__tab', isActive && 'is-active')}
                aria-label="Today"
                title="Today"
              >
                <Icon name="today" size={22} />
                <span className="pd-dock__label">Today</span>
              </NavLink>

              <NavLink
                to="/jobs"
                className={({ isActive }) => cls('pd-dock__tab', isActive && 'is-active')}
                aria-label="Jobs"
                title="Jobs"
              >
                <Icon name="jobs" size={22} />
                <span className="pd-dock__label">Jobs</span>
              </NavLink>

              {/* Raised Marigold '+' in the Centre of the Dock */}
              <Link
                to="/new"
                className="pd-dock__plus"
                aria-label="New payment request"
                title="New request"
              >
                <Icon name="plus" size={24} />
              </Link>

              <NavLink
                to="/people"
                className={({ isActive }) => cls('pd-dock__tab', isActive && 'is-active')}
                aria-label="People"
                title="People"
              >
                <Icon name="people" size={22} />
                <span className="pd-dock__label">People</span>
              </NavLink>

              <NavLink
                to="/search"
                className={({ isActive }) => cls('pd-dock__tab', isActive && 'is-active')}
                aria-label="Search"
                title="Search"
              >
                <Icon name="search" size={22} />
                <span className="pd-dock__label">Search</span>
              </NavLink>
            </div>

            {/* Desktop New Request Key next to Dock */}
            <Link to="/new" className="pd-dock__desktop-new">
              <Icon name="plus" size={18} />
              <span>New request</span>
            </Link>
          </nav>
        </div>
      </ShareProvider>
    </ToastProvider>
  );
}

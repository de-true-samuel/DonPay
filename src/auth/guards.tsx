import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LogoMark } from '../ui/Logo';
import { isOnboarded } from '../lib/onboarding';
import { SessionExpiredModal } from '../shell/SessionExpiredModal';
import { useAuth } from './AuthProvider';

function Splash() {
  return <div className="pd-splash" role="status" aria-label="Loading"><LogoMark size={48} /></div>;
}

export function RequireAuth() {
  const { status, expired } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anon' && !expired) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  }
  return (
    <>
      <Outlet />
      <SessionExpiredModal />
    </>
  );
}

export function RequireOnboarded() {
  const { provider, expired } = useAuth();
  if (expired) return <Outlet />;
  if (!provider) return null;
  if (!isOnboarded(provider.id)) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

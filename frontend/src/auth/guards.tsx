import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LogoMark } from '../ui/Logo';
import { isOnboarded } from '../lib/onboarding';
import { useAuth } from './AuthProvider';

function Splash() {
  return <div className="pd-splash" role="status" aria-label="Loading"><LogoMark size={56} /></div>;
}

export function RequireAuth() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anon') return <Navigate to="/auth" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

export function RequireOnboarded() {
  const { provider } = useAuth();
  if (!provider) return null;
  if (!isOnboarded(provider.id)) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

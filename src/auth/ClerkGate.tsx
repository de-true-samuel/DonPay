/**
 * Clerk website sign-in, on only when VITE_CLERK_PUBLISHABLE_KEY is set (and not in mock mode).
 * - Gives the API client Clerk's session token (Authorization: Bearer …) so the backend knows who is signed in.
 * - Re-checks /api/me whenever Clerk's signed-in state changes, so the app follows Clerk.
 * Without a key it renders its children unchanged: Telegram/dev sign-in keep working as before.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ClerkProvider, useAuth as useClerkAuth, useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { setAuthHooks } from '../api/authHooks';
import { CLERK_KEY } from '../config';
import { LogoMark } from '../ui/Logo';
import { ME_KEY } from './AuthProvider';

/** Clerk's sign-in card in Paidar's look: paper card, ground-blue actions, Figtree/Unbounded, ticket radii. */
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: '#2330A6', // --ground
    colorBackground: '#F5F4EF', // --paper
    colorForeground: '#14183F', // --paper-ink
    colorMutedForeground: '#5E6285', // --paper-muted
    colorDanger: '#E5392D', // --urgent
    colorSuccess: '#0E9F57', // --ok
    colorInput: '#FFFFFF',
    colorInputForeground: '#14183F',
    fontFamily: '"Figtree", system-ui, sans-serif',
    borderRadius: '12px', // --r-chip; cards get the ticket radius below
  },
  elements: {
    cardBox: { background: '#F5F4EF', borderRadius: '30px', boxShadow: '0 24px 36px rgba(16, 21, 77, 0.45)', width: 'min(420px, 100%)' },
    card: { borderRadius: '30px' },
    headerTitle: { fontFamily: '"Unbounded", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.02em' },
    formButtonPrimary: {
      background: '#FFB81C', // --cta (marigold), like the app's primary buttons
      color: '#14183F',
      borderRadius: '22px',
      minHeight: '48px',
      fontWeight: 700,
      boxShadow: '0 3px 0 #B97F00',
    },
    footer: { background: '#ECEAE3', borderTop: '2px dashed rgba(20,24,63,.14)' }, // paper stub, like the app's ticket stubs
  },
} as const;

function Bridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const clerk = useClerk();
  const qc = useQueryClient();

  // Registered during render so the very first /api/me already carries the token.
  if (isLoaded) setAuthHooks({ getToken: () => getToken(), signOut: () => clerk.signOut() });

  const prev = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    if (prev.current !== undefined && prev.current !== isSignedIn) void qc.invalidateQueries({ queryKey: ME_KEY });
    prev.current = isSignedIn;
  }, [isLoaded, isSignedIn, qc]);

  useEffect(() => () => setAuthHooks(null), []);

  if (!isLoaded) return <div className="pd-splash" role="status" aria-label="Loading"><LogoMark size={56} /></div>;
  return <>{children}</>;
}

export function ClerkGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  if (!CLERK_KEY) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={CLERK_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      afterSignOutUrl="/auth"
      appearance={CLERK_APPEARANCE}
    >
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}

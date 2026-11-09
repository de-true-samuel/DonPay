import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, UNAUTH_EVENT } from '../api/client';
import { authApi, meApi } from '../api/endpoints';
import type { Provider } from '../contract/contract';

export const ME_KEY = ['me'] as const;

interface AuthValue {
  provider: Provider | null;
  status: 'loading' | 'authed' | 'anon';
  /** True when a signed-in session ended on its own (not when the person signed out). */
  expired: boolean;
  clearExpired: () => void;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [expired, setExpired] = useState(false);
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Provider | null> => {
      try {
        return await meApi.get();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  // Any 401 from the API drops us back to the sign-in screen.
  useEffect(() => {
    const onUnauth = () => {
      if (qc.getQueryData(ME_KEY)) { setExpired(true); qc.setQueryData(ME_KEY, null); } // only counts if we were signed in
    };
    window.addEventListener(UNAUTH_EVENT, onUnauth);
    return () => window.removeEventListener(UNAUTH_EVENT, onUnauth);
  }, [qc]);

  const signOut = useCallback(async () => {
    try { await authApi.logout(); } catch { /* signing out locally either way */ }
    qc.clear();
    setExpired(false);
    qc.setQueryData(ME_KEY, null);
  }, [qc]);
  const clearExpired = useCallback(() => setExpired(false), []);

  const value = useMemo<AuthValue>(() => {
    const provider = me.data ?? null;
    const status = provider ? 'authed' : me.isPending ? 'loading' : 'anon';
    return { provider, status, expired, clearExpired, signOut };
  }, [me.data, me.isPending, expired, clearExpired, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

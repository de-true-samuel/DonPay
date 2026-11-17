/**
 * Lets the plain API client use an external sign-in (Clerk) without depending on React.
 * Registered by <ClerkGate> once Clerk has loaded; null when Clerk is off.
 */
export interface AuthHooks {
  /** A short-lived session token for the backend, or null when signed out. */
  getToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

let hooks: AuthHooks | null = null;

export function setAuthHooks(next: AuthHooks | null): void {
  hooks = next;
}

export function authHooks(): AuthHooks | null {
  return hooks;
}

/** Authorization header for the current external session, if any. Never throws. */
export async function authHeader(): Promise<Record<string, string>> {
  const token = await hooks?.getToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The contract has no onboarded flag, so this is remembered per device. */
const key = (providerId: string) => `paidar.onboarded.${providerId}`;

export function isOnboarded(providerId: string): boolean {
  try { return localStorage.getItem(key(providerId)) === '1'; } catch { return false; }
}
export function markOnboarded(providerId: string): void {
  try { localStorage.setItem(key(providerId), '1'); } catch { /* storage unavailable */ }
}

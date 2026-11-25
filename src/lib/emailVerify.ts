const PENDING_EMAIL_KEY = 'paidar.verify.pending_email';

export function getPendingVerificationEmail(): string | null {
  try {
    return window.localStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setPendingVerificationEmail(email: string | null) {
  try {
    if (email) window.localStorage.setItem(PENDING_EMAIL_KEY, email);
    else window.localStorage.removeItem(PENDING_EMAIL_KEY);
  } catch { /* ignore */ }
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

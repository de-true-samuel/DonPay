import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { cls } from '../lib/cls';
import { Icon } from '../ui/Icon';

/** The avatar in the top bar: opens a small paper card with Settings and Sign out. */
export function AccountMenu() {
  const { provider, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();

  const name = provider?.businessName?.trim() || 'Your business';
  const initial = name.charAt(0).toUpperCase() || '?';

  // Close on route change, outside tap and Escape (focus goes back to the avatar).
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleSignOut() {
    setLeaving(true);
    await signOut(); // redirects to the sign-in page
  }

  return (
    <div className="pd-acct" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={cls('pd-avatar', open && 'is-open')}
        aria-label={`Account: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {initial}
      </button>

      {open && (
        <div className="pd-acct__menu" id={menuId} role="menu" aria-label="Account">
          <div className="pd-acct__who">
            <span className="pd-acct__badge" aria-hidden="true">{initial}</span>
            <span className="pd-acct__name">
              <strong>{name}</strong>
              <span>Signed in</span>
            </span>
          </div>
          <div className="pd-acct__cut" aria-hidden="true" />
          <Link ref={firstItem} to="/settings" role="menuitem" className="pd-acct__item">
            <Icon name="gear" size={18} />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="pd-acct__item pd-acct__item--out"
            onClick={() => void handleSignOut()}
            disabled={leaving}
          >
            <Icon name="signout" size={18} />
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

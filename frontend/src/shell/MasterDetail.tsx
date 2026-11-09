import type { ReactNode } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { cls } from '../lib/cls';

/**
 * A list with its detail. On a phone one shows at a time (the list, then the detail with a Back link).
 * On a wide screen both are on screen: pick on the left, read on the right.
 */
export function MasterDetail({ base, list, empty }: { base: 'jobs' | 'people'; list: ReactNode; empty: string }) {
  const open = !!useMatch(`/${base}/:id`);
  return (
    <div className={cls('pd-md', open && 'is-detail')}>
      <div className="pd-md__list">{list}</div>
      <div className="pd-md__detail">
        {open ? <Outlet /> : <div className="pd-md__empty"><p>{empty}</p></div>}
      </div>
    </div>
  );
}

import { cls } from '../lib/cls';
import { formatNaira, splitNaira } from '../lib/money';

/** Amounts in tabular digits with the kobo de-emphasised. Screen readers get the plain amount. */
export function Money({ kobo, size = 'md', className }: { kobo: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const { neg, whole, frac } = splitNaira(kobo);
  return (
    <span className={cls('pd-money', `pd-money--${size}`, className)}>
      <span className="pd-sr-only">{formatNaira(kobo)}</span>
      <span aria-hidden="true">
        {neg && '−'}<span className="pd-money__cur">₦</span>{whole}<span className="pd-money__frac">.{frac}</span>
      </span>
    </span>
  );
}

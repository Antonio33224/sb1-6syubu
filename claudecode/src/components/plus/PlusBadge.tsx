import { clsx } from 'clsx';

/** Selo exclusivo CLASSIFY+. */
export function PlusBadge({ className, size = 'sm' }: { className?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const s = {
    xs: 'h-5 px-2 text-[8px] gap-1',
    sm: 'h-6 px-2.5 text-[9px] gap-1',
    md: 'h-8 px-3.5 text-[11px] gap-1.5',
    lg: 'h-11 px-5 text-[15px] gap-2',
  }[size];
  return (
    <span
      className={clsx('plus-frame inline-flex shrink-0 items-center font-display font-extrabold uppercase tracking-[0.16em] text-bone', s, className)}
      title="Recurso exclusivo para assinantes Classify+"
    >
      Classify<span className="text-blue">+</span>
    </span>
  );
}

/** Marca grande usada em heros (wordmark). */
export function PlusWordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('font-display font-extrabold uppercase leading-none tracking-tight', className)}>
      <span className="plus-text plus-sheen">Classify</span>
      <span className="text-blue">+</span>
    </span>
  );
}

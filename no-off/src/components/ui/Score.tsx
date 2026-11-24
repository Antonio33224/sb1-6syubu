import { clsx } from 'clsx';
import { formatScore } from '@/lib/rating';

const SIZES = {
  xs: { n: 'text-[15px]', s: 'text-[10px]' },
  sm: { n: 'text-[20px]', s: 'text-[11px]' },
  md: { n: 'text-[30px]', s: 'text-[13px]' },
  lg: { n: 'text-[44px]', s: 'text-[15px]' },
  xl: { n: 'text-[64px] sm:text-[80px]', s: 'text-[18px]' },
};

/** Nota em azul com indicador /10. */
export function Score({
  value,
  size = 'md',
  className,
  showMax = true,
}: {
  value: number | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
  showMax?: boolean;
}) {
  const s = SIZES[size];
  return (
    <span className={clsx('inline-flex items-baseline gap-[2px] font-display leading-none', className)}>
      <span className={clsx('font-bold tracking-tight text-red-bright', s.n)}>{formatScore(value)}</span>
      {showMax && <span className={clsx('font-semibold text-bone/70', s.s)}>/10</span>}
    </span>
  );
}

export function ReviewCount({ n, className }: { n: number; className?: string }) {
  return (
    <span className={clsx('text-[11px] font-medium text-mute', className)}>
      {n.toLocaleString('pt-BR')} {n === 1 ? 'avaliação' : 'avaliações'}
    </span>
  );
}

import { clsx } from 'clsx';

function rosettePath(cx: number, cy: number, outer: number, inner: number, points: number) {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const ROSETTE = rosettePath(50, 50, 47, 42.5, 24);

/** Símbolo gráfico NO OFF — selo minimalista (roseta + check). */
export function BrandMark({ className, strokeWidth = 1.6 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={clsx('text-bone', className)} aria-hidden="true">
      <path d={ROSETTE} stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <circle cx="50" cy="50" r="33" stroke="currentColor" strokeWidth={strokeWidth * 0.6} />
      <path d="M36 51.5 L46 61 L65 40" stroke="currentColor" strokeWidth={strokeWidth * 2} strokeLinecap="square" />
    </svg>
  );
}

/** Selo pequeno exibido em cards e páginas. */
export function ApprovedBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border border-bone/25 bg-ink/60 py-1 pl-1 pr-3 text-[9px] font-bold uppercase tracking-nav text-bone backdrop-blur-sm',
        className,
      )}
      title="Selo Approved — concedido automaticamente pelos critérios da plataforma"
    >
      <BrandMark className="h-5 w-5 text-red-bright" strokeWidth={2.4} />
      {compact ? 'Approved' : 'Selo Approved'}
    </span>
  );
}

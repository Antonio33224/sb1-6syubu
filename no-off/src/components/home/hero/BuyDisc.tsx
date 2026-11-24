'use client';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import { countdownText, type HeroSlide } from './hero-data';

const R = 86;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Botão de compra circular: texto girando em volta (20s por volta; acelera no
 * hover), círculo branco com lote + preço + seta. O botão inteiro é um link
 * para a página da festa.
 */
export function BuyDisc({ slide, size }: { slide: HeroSlide; size: 'sm' | 'lg' }) {
  const pathId = `hero-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const ring = `${slide.ringText} · ${slide.ringText} · `.toUpperCase();
  const lg = size === 'lg';
  const len = slide.priceText.length;
  const priceClass = lg
    ? len <= 4 ? 'text-[30px]' : len <= 6 ? 'text-[24px]' : 'text-[12px] leading-tight'
    : len <= 4 ? 'text-[19px]' : len <= 6 ? 'text-[15px]' : 'text-[8px] leading-tight';

  return (
    <Link
      href={slide.href}
      aria-label={slide.ariaBuy}
      draggable={false}
      className={clsx('group relative block shrink-0 rounded-full', lg ? 'size-[184px]' : 'size-[120px]')}
    >
      <span aria-hidden className="absolute inset-[10%] rounded-full bg-red/50 opacity-70 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
      <span aria-hidden className="hero-spin absolute inset-0 block">
        <span className="hero-spin-boost absolute inset-0 block">
          <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible">
            <defs>
              <path id={pathId} d={`M100,100 m-${R},0 a${R},${R} 0 1,1 ${R * 2},0 a${R},${R} 0 1,1 -${R * 2},0`} />
            </defs>
            <text className="fill-bone font-mono" fontSize="12.5" fontWeight="600" letterSpacing="2">
              <textPath href={`#${pathId}`} textLength={CIRCUMFERENCE - 4} lengthAdjust="spacing">
                {ring}
              </textPath>
            </text>
          </svg>
        </span>
      </span>
      <span className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-bone px-1 text-center text-ink shadow-[0_0_44px_-6px_var(--red)] transition-transform duration-500 ease-out group-hover:scale-[1.07] group-focus-visible:scale-[1.07]">
        {slide.lotLabel && (
          <span className={clsx('max-w-full truncate font-mono font-bold uppercase text-red-deep', lg ? 'text-[9px] tracking-[0.18em]' : 'text-[7px] tracking-[0.12em]')}>
            {slide.lotLabel}
          </span>
        )}
        <span className={clsx('font-display font-extrabold uppercase leading-none tracking-tight', priceClass, slide.lotLabel && (lg ? 'mt-1' : 'mt-0.5'))}>{slide.priceText}</span>
        <ArrowUpRight aria-hidden className={clsx('text-red-deep transition-transform duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5', lg ? 'mt-1 h-4 w-4' : 'mt-0.5 h-3 w-3')} strokeWidth={2.4} />
      </span>
    </Link>
  );
}

/** "Lote vira em HH:MM:SS" — só com a virada em menos de 48h; atualiza a cada segundo. */
export function LotCountdown({ endsAt, className }: { endsAt: string | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [endsAt]);
  const text = countdownText(endsAt, now);
  if (!text) return null;
  return (
    <p className={clsx('text-center font-mono uppercase text-bone', className)}>
      <span className="block text-[9px] tracking-[0.3em] text-bone/80 sm:text-[10px]">Lote vira em</span>
      <span role="timer" className="mt-1 block text-[12px] tabular-nums tracking-[0.2em] sm:text-[13px]">
        {text}
      </span>
    </p>
  );
}

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

/** Cabeçalho editorial das seções da home: índice + sobretítulo azul + título grande. */
export function HomeSectionTitle({
  index,
  eyebrow,
  title,
  text,
  href,
  linkLabel,
  aside,
}: {
  index: string;
  eyebrow: string;
  title: ReactNode;
  text?: string;
  href?: string;
  linkLabel?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-9 flex flex-wrap items-end justify-between gap-x-10 gap-y-6 sm:mb-12">
      <div className="max-w-3xl">
        <p className="flex items-center gap-3 text-[10px] font-extrabold uppercase tracking-wide2 text-blue">
          <span className="font-display text-bone/40">{index}</span>
          <span className="h-px w-8 bg-blue/60" />
          {eyebrow}
        </p>
        <h2 className="mt-4 font-display text-[38px] font-extrabold uppercase leading-[0.9] tracking-[-0.03em] text-bone text-balance sm:text-[56px] lg:text-[68px]">
          {title}
        </h2>
        {text && <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-mute sm:text-[15px]">{text}</p>}
      </div>
      {aside}
      {href && (
        <Link href={href} className="btn-outline btn-sm group shrink-0">
          {linkLabel ?? 'Ver todos'} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </Link>
      )}
    </div>
  );
}

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function SectionHeader({ title, href, linkLabel, aside }: { title: string; href?: string; linkLabel?: string; aside?: ReactNode }) {
  return (
    <div className="mb-7 flex items-end justify-between gap-6 sm:mb-9">
      <h2 className="section-title">{title}</h2>
      {aside}
      {href && (
        <Link href={href} className="link-arrow shrink-0 pb-1">
          {linkLabel ?? 'Ver todos'} <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}
